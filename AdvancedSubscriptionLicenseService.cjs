// AdvancedSubscriptionLicenseService.cjs - FIXED ENVIRONMENT VARIABLE LOADING
require('dotenv').config();
const { machineIdSync } = require('node-machine-id');
const keytar = require('keytar');
const axios = require('axios');
const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');
const configManager = require('./config-manager.cjs');
const { getLogger } = require('./logger.cjs');
const jwtTokenManager = require('./jwt-token-manager.cjs');
const logger = getLogger();

// ✅ Validate configuration on startup
try {
    configManager.validateConfiguration();
    logger.debug('Configuration validation passed');
} catch (error) {
    logger.error('Configuration validation failed', { error });
    throw error;
}

// ✅ No direct DB access - use JWT API instead
const API_BASE_URL = configManager.get('API_BASE_URL');

if (!API_BASE_URL) {
    logger.error('API_BASE_URL not found in configuration');
    throw new Error('API_BASE_URL missing - check .env.production');
}

logger.debug('License service using JWT API', {
    apiUrl: API_BASE_URL,
    environment: configManager.get('NODE_ENV', 'production')
});

// ✅ Bundled Public Key (for client-side license verification)
const BUNDLED_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHJ5Ci8AUT4Nf1rZRnVkOGeG6MoR/
Ow5JkKtOJqF1SXqNHSFrqk7kRYZJ9KnFqy9XgW1H5uszR05i7ZpsAn+isA==
-----END PUBLIC KEY-----
`;

// License signature verification functions
function canonicalJSON(obj) {
    // Handle null and primitive types
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJSON).join(',') + ']';
    }
    
    // Handle objects - sort keys and process recursively
    const keys = Object.keys(obj).filter(key => obj[key] !== undefined).sort();
    const parts = keys.map(key => `"${key}":${canonicalJSON(obj[key])}`);
    return '{' + parts.join(',') + '}';
}

// Verify license signature with your bundled public key
function verifyLicenseSignature(licenseDoc) {
    try {
        if (!licenseDoc.signature || !licenseDoc.keyId) {
            logger.warn('License not signed');
            return { valid: false, reason: 'not_signed' };
        }
        
        logger.debug('Verifying license signature', {
            licenseId: licenseDoc._id,
            keyId: licenseDoc.keyId
        });

        // This includes signature fields AND any caching/sync fields
        const { 
            signature: existingSignature, 
            keyId: existingKeyId, 
            signedAt, 
            canonicalHash,
            _rev,  // CouchDB revision
            lastSyncedAt,  // Added during caching
            syncedFromServer,  // Added during caching
            ...licenseForVerification 
        } = licenseDoc;
        
        // Create canonical JSON using the same function as server
        const canonicalData = canonicalJSON(licenseForVerification);
        
        // Calculate hash and compare
        const calculatedHash = crypto.createHash('sha256').update(canonicalData).digest('hex');
        
        
        if (calculatedHash !== canonicalHash) {
            logger.error('Canonical hash mismatch', {
                expected: canonicalHash,
                calculated: calculatedHash
            });
            return { valid: false, reason: 'hash_mismatch', calculatedHash, expectedHash: canonicalHash };
        }
        
        // Verify signature using bundled public key
        const verify = crypto.createVerify('SHA256');
        verify.update(canonicalData);
        verify.end();
        
        const isValid = verify.verify(BUNDLED_PUBLIC_KEY, existingSignature, 'base64');
        
        if (isValid) {
            logger.debug('License signature verified successfully');
            return { valid: true, keyId: existingKeyId, signedAt, reason: 'signature_valid' };
        } else {
            logger.error('Invalid license signature');
            return { valid: false, reason: 'invalid_signature' };
        }
        
    } catch (error) {
        logger.error('License verification error', { error });
        return { valid: false, reason: 'verification_error', error: error.message };
    }
}

// Service name for keytar
const SERVICE_NAME = 'PharmAssistPOS';
const ACCOUNT_NAME = 'device-registration';
const SUBSCRIPTION_ACCOUNT = 'subscription-data';


// Global flags to prevent duplicate operations and add startup delays
let isRegistering = false;
let lastRegistrationTime = 0;
let lastLicenseCheckTime = 0;
let hasPerformedStartupSync = false;
let isOnlineCheckDone = false;
let cachedSubscription = null;
let cacheExpiry = 0;
// ADD: Store ID management methods
let currentStoreId = null;

const setStoreId = (storeId) => {
    currentStoreId = storeId;
    logger.info('License service bound to store', { storeId });
};

const getStoreId = () => {
    return currentStoreId;
};

const validateStoreBinding = async (licenseStoreId, currentStoreId) => {
    if (!licenseStoreId || !currentStoreId) {
        return { valid: false, reason: 'Missing store ID data' };
    }
    
    if (licenseStoreId !== currentStoreId) {
        logger.warn('Store binding mismatch', {
            licenseStore: licenseStoreId,
            currentStore: currentStoreId
        });
        return { 
            valid: false, 
            reason: 'Store ID mismatch - license bound to different store',
            licenseStore: licenseStoreId,
            currentStore: currentStoreId
        };
    }
    
    logger.debug('Store binding validated', { storeId: currentStoreId });
    return { valid: true, reason: 'Store binding validated' };
};


// COOLDOWN PERIODS
const REGISTRATION_COOLDOWN = 60000; // 1 minute between registration attempts
const LICENSE_CHECK_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours
const STARTUP_DELAY = 5000; // 5 seconds delay before allowing subscription requests
const SUBSCRIPTION_REQUEST_COOLDOWN = 2 * 60 * 1000; // 2 minutes between subscription requests

// Startup timing
let appStartupTime = Date.now();
let lastSubscriptionRequestTime = 0;

// Security and subscription settings
const MAX_OFFLINE_DAYS = 7;
const SUBSCRIPTION_PLANS = {
    // ========================================
    // DEMO PLANS (14 days trial)
    // ========================================
    DEMO_SINGLE: {
        duration: 14 * 24 * 60 * 60 * 1000,
        name: 'Demo - Single Device',
        displayName: '14-Day Demo (Single Device)',
        maxDevices: 1,
        lanSync: false,
        requiresCouchDB: false,
        price: 0,
        description: 'Try basic POS features with PouchDB only',
        features: [
            'Single device only',
            'PouchDB local storage',
            'No cloud sync',
            'Basic POS features',
            '14 days access'
        ],
        planTier: 'demo',
        syncMode: 'pouchdb_only'
    },
    
    DEMO_MULTI: {
        duration: 14 * 24 * 60 * 60 * 1000,
        name: 'Demo - Multiple Devices',
        displayName: '14-Days Demo (Multi-Device)',
        maxDevices: 3,
        lanSync: true,
        requiresCouchDB: true,
        price: 0,
        description: 'Try multi-device with LAN sync',
        features: [
            'Up to 3 devices',
            'Local CouchDB sync required',
            'LAN synchronization',
            'Full POS features',
            '14 days access'
        ],
        planTier: 'demo',
        syncMode: 'couchdb_required'
    },

    // ========================================
    // MONTHLY PLANS
    // ========================================
    MONTHLY_SINGLE_BASIC: {
        duration: 30 * 24 * 60 * 60 * 1000,
        name: 'Monthly - Single Device (Basic)',
        displayName: '1 Month - Single Device - Basic',
        maxDevices: 1,
        lanSync: false,
        requiresCouchDB: false,
        price: 2000,
        description: 'Single device with PouchDB only',
        features: [
            'Single device only',
            'PouchDB local storage',
            'No cloud sync needed',
            'Full POS features',
            'Email support',
            '30 days access'
        ],
        planTier: 'monthly',
        syncMode: 'pouchdb_only'
    },

    MONTHLY_MULTI: {
        duration: 30 * 24 * 60 * 60 * 1000,
        name: 'Monthly - Multiple Devices',
        displayName: '1 Month - Multi-Device',
        maxDevices: 5,
        lanSync: true,
        requiresCouchDB: true,
        price: 3500,
        description: 'Multiple devices with LAN sync',
        features: [
            'Up to 5 devices',
            'Local CouchDB sync required',
            'Real-time LAN sync',
            'Manager-Cashier setup',
            'Full POS features',
            'Priority support',
            '30 days access'
        ],
        planTier: 'monthly',
        syncMode: 'couchdb_required'
    },

    // ========================================
    // QUARTERLY PLANS (3 months)
    // ========================================
    QUARTERLY_SINGLE_BASIC: {
        duration: 90 * 24 * 60 * 60 * 1000,
        name: 'Quarterly - Single Device (Basic)',
        displayName: '3 Months - Single Device - Basic',
        maxDevices: 1,
        lanSync: false,
        requiresCouchDB: false,
        price: 6000,
        savings: '11% off monthly rate',
        description: 'Single device with PouchDB only',
        features: [
            'Single device only',
            'PouchDB local storage',
            'No cloud sync needed',
            'Full POS features',
            'Email support',
            '90 days access',
            'Save 11% vs monthly'
        ],
        planTier: 'quarterly',
        syncMode: 'pouchdb_only'
    },

    QUARTERLY_MULTI: {
        duration: 90 * 24 * 60 * 60 * 1000,
        name: 'Quarterly - Multiple Devices',
        displayName: '3 Months - Multi-Device',
        maxDevices: 5,
        lanSync: true,
        requiresCouchDB: true,
        price: 9500,
        savings: '10% off monthly rate',
        description: 'Multiple devices with LAN sync',
        features: [
            'Up to 5 devices',
            'Local CouchDB sync required',
            'Real-time LAN sync',
            'Manager-Cashier setup',
            'Full POS features',
            'Priority support',
            '90 days access',
            'Save 10% vs monthly'
        ],
        planTier: 'quarterly',
        syncMode: 'couchdb_required'
    }
};

// Helper function to get plans by category
const getPlansByCategory = () => {
    return {
        demo: Object.entries(SUBSCRIPTION_PLANS)
            .filter(([key]) => key.startsWith('DEMO_'))
            .map(([key, plan]) => ({ id: key, ...plan })),
        
        monthly: Object.entries(SUBSCRIPTION_PLANS)
            .filter(([key]) => key.startsWith('MONTHLY_'))
            .map(([key, plan]) => ({ id: key, ...plan })),
        
        quarterly: Object.entries(SUBSCRIPTION_PLANS)
            .filter(([key]) => key.startsWith('QUARTERLY_'))
            .map(([key, plan]) => ({ id: key, ...plan }))
    };
};

// Event emitter for license status changes
const { EventEmitter } = require('events');
const licenseEventEmitter = new EventEmitter();

// Singleton axios instance
let axiosInstance = null;
const getAxiosInstance = () => {
    if (!axiosInstance) {
        // ✅ Use JWT authenticated requests instead
        axiosInstance = axios.create({
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        // Add retry interceptor
        axiosInstance.interceptors.response.use(
            (response) => response,
            async (error) => {
                const config = error.config;
                
                if (!config || config.__retryCount >= (config.maxRetries || 3)) {
                    return Promise.reject(error);
                }
                
                config.__retryCount = config.__retryCount || 0;
                config.__retryCount += 1;
                
                const delay = Math.min(
                    (config.retryDelay || 1000) * Math.pow(2, config.__retryCount - 1) + 
                    Math.random() * 1000, 
                    10000
                );
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return axiosInstance(config);
            }
        );
    }
    return axiosInstance;
};

// SECURITY: Proper encryption implementation
const encryptData = (data, key) => {
    try {
        const algorithm = 'aes-256-gcm';
        const salt = crypto.randomBytes(32);
        const derivedKey = crypto.scryptSync(key, salt, 32);
        const iv = crypto.randomBytes(12);

        const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);
        cipher.setAAD(Buffer.from('PharmAssist-Auth'));

        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        return {
            encrypted,
            salt: salt.toString('hex'),
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    } catch (error) {
        return {
            encrypted: Buffer.from(JSON.stringify(data)).toString('base64'),
            fallback: true
        };
    }
};

const decryptData = (encryptedObj, key) => {
    try {
        if (encryptedObj.fallback) {
            return JSON.parse(
                Buffer.from(encryptedObj.encrypted, 'base64').toString('utf8')
            );
        }

        const algorithm = 'aes-256-gcm';
        const salt = Buffer.from(encryptedObj.salt, 'hex');
        const derivedKey = crypto.scryptSync(key, salt, 32);
        const iv = Buffer.from(encryptedObj.iv, 'hex');
        const authTag = Buffer.from(encryptedObj.authTag, 'hex');

        const decipher = crypto.createDecipheriv(algorithm, derivedKey, iv);
        decipher.setAAD(Buffer.from('PharmAssist-Auth'));
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedObj.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (error) {
        throw new Error('Failed to decrypt data');
    }
};

// Hardware component scoring system
const HARDWARE_COMPONENT_WEIGHTS = {
    machineId: 30,
    motherboardSerial: 25,
    systemUUID: 20,
    cpuSignature: 15,
    memorySize: 5,
    diskSerial: 5,
    networkMAC: 3,
    hostname: 2,
    platform: 5
};

const MIN_HARDWARE_SCORE = 50;

// Get hardware component with fallback
const getHardwareComponent = (componentName, getFunction, fallbackValue = null) => {
    try {
        const value = getFunction();
        const weight = HARDWARE_COMPONENT_WEIGHTS[componentName] || 0;
        
        if (!value || 
            value === 'Unknown' || 
            value === 'Not Available' ||
            value.includes('ERROR') ||
            value.length < 3) {
            
            return {
                component: componentName,
                value: fallbackValue || `FALLBACK_${componentName.toUpperCase()}`,
                weight: Math.floor(weight * 0.3),
                reliable: false,
                source: 'fallback'
            };
        }
        
        return {
            component: componentName,
            value: value,
            weight: weight,
            reliable: true,
            source: 'hardware'
        };
        
    } catch (error) {
        return {
            component: componentName,
            value: fallbackValue || `ERROR_${componentName.toUpperCase()}`,
            weight: Math.floor((HARDWARE_COMPONENT_WEIGHTS[componentName] || 0) * 0.1),
            reliable: false,
            source: 'error'
        };
    }
};

// Windows hardware info
const getWindowsHardwareInfo = () => {
    const components = {};
    
    components.motherboardSerial = getHardwareComponent('motherboardSerial', () => {
        const result = execSync('wmic baseboard get serialnumber /value', { 
            encoding: 'utf8', 
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const serial = result.match(/SerialNumber=(.+)/)?.[1]?.trim();
        return serial && serial !== 'To be filled by O.E.M.' ? serial : null;
    }, 'WIN_MB_GENERIC');
    
    components.systemUUID = getHardwareComponent('systemUUID', () => {
        const result = execSync('wmic csproduct get uuid /value', { 
            encoding: 'utf8', 
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const uuid = result.match(/UUID=(.+)/)?.[1]?.trim();
        return uuid && uuid !== '00000000-0000-0000-0000-000000000000' ? uuid : null;
    }, 'WIN_UUID_GENERIC');
    
    components.cpuSignature = getHardwareComponent('cpuSignature', () => {
        const cpuResult = execSync('wmic cpu get processorid /value', { 
            encoding: 'utf8', 
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const cpuId = cpuResult.match(/ProcessorId=(.+)/)?.[1]?.trim();
        
        if (cpuId && cpuId !== 'Not Available') {
            return cpuId;
        }
        
        const cpus = os.cpus();
        return crypto.createHash('md5')
            .update(`${cpus[0]?.model || 'unknown'}${cpus.length}${cpus[0]?.speed || 0}`)
            .digest('hex')
            .substring(0, 16);
    }, 'WIN_CPU_GENERIC');
    
    components.biosSerial = getHardwareComponent('biosSerial', () => {
        const result = execSync('wmic bios get serialnumber /value', { 
            encoding: 'utf8', 
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return result.match(/SerialNumber=(.+)/)?.[1]?.trim();
    }, 'WIN_BIOS_GENERIC');
    
    components.diskSerial = getHardwareComponent('diskSerial', () => {
        const result = execSync('wmic diskdrive where "MediaType=\'Fixed hard disk media\'" get serialnumber /value', { 
            encoding: 'utf8', 
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const diskSerial = result.match(/SerialNumber=(.+)/)?.[1]?.trim();
        return diskSerial && diskSerial.length > 5 ? diskSerial : null;
    }, 'WIN_DISK_GENERIC');
    
    return components;
};

// Unix/Linux/Mac hardware info
const getUnixHardwareInfo = () => {
    const components = {};
    const platform = os.platform();
    
    components.systemUUID = getHardwareComponent('systemUUID', () => {
        if (platform === 'linux') {
            const sources = [
                '/sys/class/dmi/id/product_uuid',
                '/proc/sys/kernel/random/uuid',
                '/sys/firmware/efi/efivars/system-uuid'
            ];
            
            for (const source of sources) {
                try {
                    const uuid = execSync(`cat ${source}`, { encoding: 'utf8', timeout: 2000 }).trim();
                    if (uuid && uuid.length > 10) return uuid;
                } catch (e) {
                    continue;
                }
            }
            return null;
            
        } else if (platform === 'darwin') {
            return execSync('system_profiler SPHardwareDataType | grep "Hardware UUID" | awk \'{print $3}\'', { 
                encoding: 'utf8', 
                timeout: 3000 
            }).trim();
        }
        return null;
    }, `${platform.toUpperCase()}_UUID_GENERIC`);
    
    components.motherboardSerial = getHardwareComponent('motherboardSerial', () => {
        if (platform === 'linux') {
            const sources = [
                '/sys/class/dmi/id/board_serial',
                '/sys/class/dmi/id/product_serial'
            ];
            
            for (const source of sources) {
                try {
                    const serial = execSync(`cat ${source}`, { encoding: 'utf8', timeout: 2000 }).trim();
                    if (serial && serial !== 'To be filled by O.E.M.' && serial.length > 5) {
                        return serial;
                    }
                } catch (e) {
                    continue;
                }
            }
            return null;
            
        } else if (platform === 'darwin') {
            return execSync('system_profiler SPHardwareDataType | grep "Serial Number" | awk \'{print $4}\'', { 
                encoding: 'utf8', 
                timeout: 3000 
            }).trim();
        }
        return null;
    }, `${platform.toUpperCase()}_MB_GENERIC`);
    
    components.cpuSignature = getHardwareComponent('cpuSignature', () => {
        const cpus = os.cpus();
        return crypto.createHash('md5')
            .update(`${cpus[0]?.model || 'unknown'}${cpus.length}${cpus[0]?.speed || 0}`)
            .digest('hex')
            .substring(0, 16);
    }, `${platform.toUpperCase()}_CPU_GENERIC`);
    
    return components;
};

// Network fingerprinting
const getNetworkFingerprint = () => {
    try {
        const interfaces = os.networkInterfaces();
        const physicalInterfaces = [];
        
        for (const [name, nets] of Object.entries(interfaces)) {
            for (const net of nets) {
                if (net.internal || !net.mac || net.mac === '00:00:00:00:00:00') continue;
                
                const virtualPatterns = [
                    'vEthernet', 'VMware', 'VirtualBox', 'Hyper-V',
                    'vboxnet', 'vmnet', 'docker', 'br-', 'virbr'
                ];
                
                if (virtualPatterns.some(pattern => name.toLowerCase().includes(pattern.toLowerCase()))) {
                    continue;
                }
                
                const hashedMAC = crypto.createHash('sha256').update(net.mac).digest('hex').substring(0, 12);
                
                physicalInterfaces.push({
                    name: name.substring(0, 10),
                    family: net.family,
                    macHash: hashedMAC
                });
            }
        }
        
        const networkSignature = physicalInterfaces.length > 0 
            ? crypto.createHash('md5').update(JSON.stringify(physicalInterfaces)).digest('hex').substring(0, 12)
            : 'NO_NETWORK_SIGNATURE';
        
        return getHardwareComponent('networkMAC', () => {
            return networkSignature;
        }, 'NETWORK_FALLBACK');
        
    } catch (error) {
        return getHardwareComponent('networkMAC', () => {
            return 'NETWORK_ERROR';
        }, 'NETWORK_FALLBACK');
    }
};

// Main flexible fingerprint function
const generateFlexibleDeviceFingerprint = () => {
    try {
        const coreComponents = {};
        
        coreComponents.machineId = getHardwareComponent('machineId', () => {
            return machineIdSync({ isProtected: true });
        }, 'MACHINE_ID_FALLBACK');
        
        let platformComponents;
        if (os.platform() === 'win32') {
            platformComponents = getWindowsHardwareInfo();
        } else {
            platformComponents = getUnixHardwareInfo();
        }
        
        const systemComponents = {};
        
        systemComponents.platform = getHardwareComponent('platform', () => {
            return os.platform();
        }, 'UNKNOWN_PLATFORM');
        
        systemComponents.memorySize = getHardwareComponent('memorySize', () => {
            return Math.round(os.totalmem() / (1024 * 1024 * 1024)).toString() + 'GB';
        }, '4GB');
        
        systemComponents.hostname = getHardwareComponent('hostname', () => {
            return crypto.createHash('md5').update(os.hostname()).digest('hex').substring(0, 12);
        }, 'HOSTNAME_FALLBACK');
        
        const networkComponent = getNetworkFingerprint();
        
        const allComponents = {
            ...coreComponents,
            ...platformComponents,
            ...systemComponents,
            networkMAC: networkComponent
        };
        
        const totalScore = Object.values(allComponents)
            .reduce((sum, comp) => sum + (comp.weight || 0), 0);
            
        const reliableComponents = Object.values(allComponents)
            .filter(comp => comp.reliable);
        
        const reliableValues = reliableComponents
            .sort((a, b) => b.weight - a.weight)
            .map(comp => comp.value)
            .filter(Boolean);
            
        const allValues = Object.values(allComponents)
            .sort((a, b) => b.weight - a.weight)
            .map(comp => comp.value)
            .filter(Boolean);
        
        const primaryFingerprint = crypto.createHash('sha256')
            .update(reliableValues.slice(0, 5).join('|'))
            .digest('hex');
        
        const secondaryFingerprint = crypto.createHash('sha256')
            .update(allValues.join('|'))
            .digest('hex');
        
        const compositeFingerprint = crypto.createHash('sha256')
            .update(primaryFingerprint + secondaryFingerprint + totalScore.toString())
            .digest('hex');
        
        const baseKey = coreComponents.machineId.value || 'FALLBACK_KEY';
        const fingerprintHmac = crypto.createHmac('sha256', baseKey)
            .update(compositeFingerprint + Date.now().toString())
            .digest('hex');
        
        const fingerprintData = {
            components: allComponents,
            scores: {
                total: totalScore,
                minimum: MIN_HARDWARE_SCORE,
                reliable: reliableComponents.length
            },
            fingerprints: {
                primary: primaryFingerprint,
                secondary: secondaryFingerprint,
                composite: compositeFingerprint
            },
            metadata: {
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                generatedAt: new Date().toISOString(),
                version: '3.0-flexible'
            }
        };
        
        const encryptionKey = crypto.createHash('sha256')
            .update(baseKey + primaryFingerprint)
            .digest('hex')
            .substring(0, 32);
        
        const encrypted = encryptData(fingerprintData, encryptionKey);
        
        let bindingStrength = 'weak';
        if (totalScore >= MIN_HARDWARE_SCORE && reliableComponents.length >= 3) {
            bindingStrength = 'medium';
        }
        if (totalScore >= 70 && reliableComponents.length >= 4) {
            bindingStrength = 'strong';
        }
        if (totalScore >= 90 && reliableComponents.length >= 5) {
            bindingStrength = 'very_strong';
        }
        
        return {
            fingerprint: compositeFingerprint,
            fingerprintHmac: fingerprintHmac,
            encrypted: encrypted,
            strength: bindingStrength,
            score: totalScore,
            components: Object.keys(allComponents).length,
            reliable: reliableComponents.length,
            flexible: true,
            raw: {
                platform: os.platform(),
                totalScore: totalScore,
                reliableComponents: reliableComponents.length,
                bindingStrength: bindingStrength,
                ipAddress: 'Network Interface'
            }
        };
        
    } catch (error) {
        try {
            const machineId = machineIdSync({ isProtected: true });
            const basicComponents = [
                machineId,
                os.platform(),
                os.arch(),
                os.type(),
                Math.round(os.totalmem() / (1024 * 1024 * 1024)).toString(),
                os.cpus().length.toString(),
                Date.now().toString()
            ];
            
            const fallbackHash = crypto.createHash('sha256')
                .update(basicComponents.join('|'))
                .digest('hex');
            
            const fallbackHmac = crypto.createHmac('sha256', machineId)
                .update(fallbackHash)
                .digest('hex');
            
            const fallbackData = {
                machineId: machineId,
                platform: os.platform(),
                arch: os.arch(),
                fallbackMode: true,
                timestamp: Date.now()
            };
            
            const encrypted = encryptData(fallbackData, machineId.substring(0, 32));
            
            return {
                fingerprint: fallbackHash,
                fingerprintHmac: fallbackHmac,
                encrypted: encrypted,
                strength: 'fallback',
                score: 25,
                components: basicComponents.length,
                reliable: 1,
                flexible: true,
                raw: {
                    platform: os.platform(),
                    fallbackMode: true,
                    ipAddress: 'Network Interface'
                }
            };
            
        } catch (fallbackError) {
            throw new Error('Complete fingerprint generation failure - system security compromised');
        }
    }
};

// Flexible validation
const validateFlexibleFingerprint = (storedFingerprint, currentFingerprint, tolerance = 0.7) => {
    try {
        if (!storedFingerprint || !currentFingerprint) {
            return { valid: false, reason: 'Missing fingerprint data' };
        }
        
        const storedScore = storedFingerprint.score || 0;
        const currentScore = currentFingerprint.score || 0;
        
        const scoreDifference = Math.abs(storedScore - currentScore);
        const maxAllowedDifference = storedScore * (1 - tolerance);
        
        if (scoreDifference > maxAllowedDifference) {
            return { 
                valid: false, 
                reason: `Hardware changes too significant: ${scoreDifference}/${maxAllowedDifference}`,
                suggestion: 'Contact support for license transfer'
            };
        }
        
        const storedComponents = storedFingerprint.encrypted?.components || {};
        const currentComponents = currentFingerprint.encrypted?.components || {};
        
        if (storedComponents.machineId?.value !== currentComponents.machineId?.value) {
            return { 
                valid: false, 
                reason: 'Core system identifier mismatch',
                suggestion: 'This appears to be a different computer'
            };
        }
        
        return { 
            valid: true, 
            reason: 'Hardware validation passed',
            scoreDifference: scoreDifference,
            tolerance: tolerance
        };
        
    } catch (error) {
        return { valid: false, reason: 'Validation process failed' };
    }
};

const generateTerminalId = () => {
    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const timestamp = Date.now().toString(36).toUpperCase();
        const machineId = machineIdSync({ isProtected: true });
        const entropy = crypto.createHash('md5').update(machineId).digest('hex').substring(0, 6).toUpperCase();
        const random = Array.from({length: 6}, () => chars[crypto.randomInt(0, chars.length)]).join('');
        return `TERM-${timestamp}-${entropy}-${random}`;
    } catch (error) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Array.from({length: 12}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
        return `TERM-${timestamp}-FALLBACK-${random}`;
    }
};

const getMachineId = () => {
    try {
        return machineIdSync({ isProtected: true });
    } catch (error) {
        throw new Error("Machine ID is required for security");
    }
};

// Connection pooling and caching
let connectionStatus = null;
let connectionCheckTime = 0;
const CONNECTION_CACHE_TIME = 60000; // 1 minute

// ✅ Current code is OK but verify it looks like this:
const checkDatabaseConnectivity = async () => {
    const now = Date.now();
    
    if (connectionStatus !== null && (now - connectionCheckTime) < CONNECTION_CACHE_TIME) {
        return connectionStatus;
    }
    
    try {
        const API_BASE_URL = configManager.get('API_BASE_URL');
        const response = await axios.get(`${API_BASE_URL}/health`, {
            timeout: 10000
        });
        
        connectionStatus = true;
        connectionCheckTime = now;
        
        logger.debug('API server connectivity check: online');
        return true;
    } catch (error) {
        connectionStatus = false;
        connectionCheckTime = now;
        
        logger.debug('API server connectivity check: offline');
        return false;
    }
};

// One-time startup sync with better caching
const performStartupSync = async () => {
    if (hasPerformedStartupSync) {
        return false;
    }

    const dbConnected = await checkDatabaseConnectivity();
    if (!dbConnected) {
        isOnlineCheckDone = true;
        hasPerformedStartupSync = true;
        return false;
    }

    hasPerformedStartupSync = true;
    isOnlineCheckDone = true;
    return true;
};




const checkSubscriptionWithSignatureVerification = async (forceServerCheck = false) => {
    const machineId = getMachineId();
    const now = Date.now();

    logger.debug('Checking subscription with signature verification');

    // Startup delay check
    if ((now - appStartupTime) < STARTUP_DELAY) {
        logger.debug('App startup delay active', {
            remaining: STARTUP_DELAY - (now - appStartupTime)
        });
        return {
            success: true,
            isValid: false,
            status: 'startup_delay',
            message: 'Application is starting up, please wait...',
            delay: STARTUP_DELAY - (now - appStartupTime)
        };
    }

    // Get store ID
    const storeIdToUse = currentStoreId || getStoreId();
    
    if (!storeIdToUse) {
        logger.warn('No store ID available for subscription check');
        return {
            success: true,
            isValid: false,
            status: 'no_store_binding',
            message: 'No store ID available - cannot verify subscription',
            isOnline: false,
            storeId: null
        };
    }

    logger.debug('Checking subscription for store', { storeId: storeIdToUse });

    // Load cached subscription
    let localSubscription = null;
    let isUnsignedCache = false;
    const STORE_CACHE_KEY = `store-subscription-${storeIdToUse}`;
    
    try {
        logger.debug('Checking store-specific cache', { cacheKey: STORE_CACHE_KEY });
        const storeCacheData = await keytar.getPassword(SERVICE_NAME, STORE_CACHE_KEY);
        
        if (storeCacheData) {
            const parsedData = JSON.parse(storeCacheData);
            
            logger.debug('Found cached subscription', {
                storeId: parsedData.storeId,
                expiresAt: parsedData.subscription?.expiresAt,
                hasSignature: !!parsedData.signature
            });
            
            // Handle unsigned cache
            if (!parsedData.signature) {
                logger.warn('Cached subscription is unsigned (legacy format)');
                isUnsignedCache = true;
                
                const migration = await migrateUnsignedCachedSubscription(parsedData, storeIdToUse);
                
                if (migration.success && migration.subscription) {
                    localSubscription = migration.subscription;
                    logger.info('Successfully migrated to signed subscription');
                } else if (migration.needsMigration) {
                    logger.warn('Using unsigned cache temporarily (offline)');
                    localSubscription = parsedData;
                    localSubscription._unsignedCache = true;
                } else {
                    logger.warn('Migration failed, clearing unsigned cache');
                    await keytar.deletePassword(SERVICE_NAME, STORE_CACHE_KEY);
                    localSubscription = null;
                }
            } else {
                // Verify signature
                const signatureCheck = verifyLicenseSignature(parsedData);
                if (signatureCheck.valid) {
                    localSubscription = parsedData;
                    logger.debug('Store cache signature verified');
                } else {
                    logger.warn('Store cache signature invalid', {
                        reason: signatureCheck.reason
                    });
                    await keytar.deletePassword(SERVICE_NAME, STORE_CACHE_KEY);
                    localSubscription = null;
                }
            }
        }
        
        // Fallback to device-specific cache if needed
        if (!localSubscription) {
            logger.debug('Checking device-specific cache');
            const deviceCacheData = await keytar.getPassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT);
            
            if (deviceCacheData) {
                const parsedData = JSON.parse(deviceCacheData);
                
                // Check store match
                const cachedStoreId = parsedData.storeId || parsedData.storeBinding?.storeId;
                if (cachedStoreId === storeIdToUse) {
                    // Handle unsigned device cache same way
                    if (!parsedData.signature) {
                        logger.warn('Device cache is unsigned (legacy format)');
                        const migration = await migrateUnsignedCachedSubscription(parsedData, storeIdToUse);
                        
                        if (migration.success && migration.subscription) {
                            localSubscription = migration.subscription;
                        } else if (migration.needsMigration) {
                            localSubscription = parsedData;
                            localSubscription._unsignedCache = true;
                        }
                    } else {
                        const signatureCheck = verifyLicenseSignature(parsedData);
                        if (signatureCheck.valid) {
                            localSubscription = parsedData;
                            logger.debug('Device cache signature verified');
                        }
                    }
                } else {
                    logger.warn('Device cache store mismatch', {
                        cached: cachedStoreId,
                        current: storeIdToUse
                    });
                }
            }
        }
        
    } catch (error) {
        logger.warn('Error reading cached subscription', { error: error.message });
    }

    // Check connectivity
    const isOnline = await checkDatabaseConnectivity();
    logger.debug('Database connectivity status', { isOnline });

    // Server check logic
    let shouldCheckServer = forceServerCheck || !localSubscription || isUnsignedCache;
    
    if (localSubscription && localSubscription.cachedAt && !isUnsignedCache) {
        const lastSync = new Date(localSubscription.cachedAt);
        const daysSinceSync = (now - lastSync.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceSync > 1) {
            shouldCheckServer = true;
            logger.debug('Cache is stale, forcing server check', { 
                daysSinceSync: daysSinceSync.toFixed(1) 
            });
        }
    }

    // ⚡ CRITICAL FIX: Server check with proper validation for deleted licenses
    if (shouldCheckServer && isOnline) {
    try {
        logger.info('Checking server for latest subscription', { storeId: storeIdToUse });
        
        // USE JWT authenticated API call
        const result = await jwtTokenManager.makeAuthenticatedRequest(
            '/check-subscription',
            {
                method: 'POST',
                data: { 
                    storeId: storeIdToUse,
                    machineId: machineId
                }
            }
        );
        
        if (!result.success) {
            throw new Error(result.error || 'API request failed');
        }
        
        const apiResponse = result.data;
        
        // Check if license exists on server
        if (!apiResponse.found || !apiResponse.license) {
            logger.error('License not found on server while online', {
                storeId: storeIdToUse,
                hadCachedLicense: !!localSubscription
            });
            
            // Clear ALL caches when license deleted from server
            logger.warn('Clearing all caches - license deleted from server');
            
            try {
                await keytar.deletePassword(SERVICE_NAME, STORE_CACHE_KEY);
                await keytar.deletePassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT);
                await keytar.deletePassword(SERVICE_NAME, 'device-registration');
                await keytar.deletePassword(SERVICE_NAME, 'device-registration-cache');
                
                logger.info('All subscription caches cleared due to deleted license');
            } catch (clearError) {
                logger.error('Failed to clear caches', { error: clearError.message });
            }
            
            return {
                success: true,
                isValid: false,
                status: 'license_deleted',
                source: 'server',
                signatureVerified: false,
                storeId: storeIdToUse,
                isOnline: true,
                cachesCleared: true,
                message: 'License has been revoked or deleted. Please contact support to reactivate.',
                requiresReactivation: true,
                forceLogout: true
            };
        }
        
        const serverLicense = apiResponse.license;
        
        // Verify server license signature
        const serverSignatureCheck = verifyLicenseSignature(serverLicense);
        if (!serverSignatureCheck.valid) {
            logger.error('Server license signature invalid', {
                reason: serverSignatureCheck.reason
            });
            
            if (localSubscription && localSubscription._unsignedCache) {
                logger.warn('Server invalid but using unsigned cache temporarily');
            } else {
                return {
                    success: true,
                    isValid: false,
                    status: 'server_signature_invalid',
                    source: 'server',
                    signatureVerified: false,
                    storeId: storeIdToUse,
                    message: `Server license signature invalid: ${serverSignatureCheck.reason}`
                };
            }
        } else {
            logger.info('Server license signature verified - updating cache');
            
            // Cache to BOTH locations with server data
            const cacheData = {
                ...serverLicense,
                storeId: storeIdToUse,
                cachedAt: new Date().toISOString(),
                syncedFromServer: true,
                lastSyncedAt: new Date().toISOString()
            };
            
            await keytar.setPassword(SERVICE_NAME, STORE_CACHE_KEY, JSON.stringify(cacheData));
            await keytar.setPassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT, JSON.stringify(cacheData));
            
            localSubscription = cacheData;
            isUnsignedCache = false;
            
            logger.debug('Server license cached successfully');
        }
    } catch (error) {
        logger.warn('Server check failed, using cached data', { 
            error: error.message,
            hadCachedLicense: !!localSubscription
        });
        
        // Don't clear cache on network errors
        if (error.response?.status === 404 && error.response?.data?.reason === 'no_db_file') {
            logger.warn('License database not accessible on server');
        }
    }
}

    // Final validation - no subscription found anywhere
    if (!localSubscription) {
        logger.warn('No subscription found in cache or server', {
            storeId: storeIdToUse,
            isOnline
        });
        
        return {
            success: true,
            isValid: false,
            status: 'no_subscription',
            source: 'none',
            signatureVerified: false,
            storeId: storeIdToUse,
            isOnline,
            message: isOnline ? 
                'No subscription found for this store. Please register a license.' : 
                'Offline - No cached subscription found. Connect to internet to verify license.'
        };
    }

    // Store binding validation
    const licenseStoreId = localSubscription.storeBinding?.storeId || localSubscription.storeId;
    if (licenseStoreId && licenseStoreId !== storeIdToUse) {
        logger.error('Store binding validation failed', {
            licenseStore: licenseStoreId,
            currentStore: storeIdToUse
        });
        
        // Clear mismatched cache if online
        if (isOnline) {
            await keytar.deletePassword(SERVICE_NAME, STORE_CACHE_KEY);
            await keytar.deletePassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT);
            logger.info('Cleared mismatched store cache');
        }
        
        return {
            success: true,
            isValid: false,
            status: 'store_mismatch',
            source: localSubscription.syncedFromServer ? 'server' : 'cache',
            signatureVerified: false,
            storeId: storeIdToUse,
            isOnline,
            message: `License bound to different store (${licenseStoreId})`
        };
    }

    // Expiration check
    const currentTime = new Date();
    const expiresAt = new Date(localSubscription.subscription?.expiresAt || localSubscription.expiresAt);
    const isExpired = currentTime > expiresAt;
    
    if (isExpired) {
        logger.warn('Subscription expired', {
            expiresAt: expiresAt.toISOString(),
            storeId: storeIdToUse,
            isOnline
        });
        
        // ⚡ Offline grace period (7 days after expiration)
        if (!isOnline) {
            const daysExpired = (currentTime.getTime() - expiresAt.getTime()) / (24 * 60 * 60 * 1000);
            const maxOfflineGraceDays = 7;
            
            if (daysExpired <= maxOfflineGraceDays) {
                const graceDaysRemaining = maxOfflineGraceDays - Math.floor(daysExpired);
                
                logger.info('Offline grace period active', {
                    daysExpired: Math.floor(daysExpired),
                    graceDaysRemaining
                });
                
                return {
                    success: true,
                    isValid: true,
                    status: 'expired_grace',
                    source: localSubscription.syncedFromServer ? 'server' : 'cache',
                    signatureVerified: !isUnsignedCache,
                    unsignedCache: isUnsignedCache,
                    storeId: storeIdToUse,
                    isOnline: false,
                    message: `Subscription expired ${Math.floor(daysExpired)} days ago - ${graceDaysRemaining} days of offline access remaining`,
                    expiresAt: expiresAt.toISOString(),
                    plan: localSubscription.subscription?.plan || localSubscription.plan,
                    timeUntilExpiry: `Expired ${Math.floor(daysExpired)} days ago (offline grace)`,
                    lastSyncedAt: localSubscription.cachedAt || localSubscription.lastSyncedAt,
                    offlineGrace: true,
                    graceDaysRemaining: graceDaysRemaining
                };
            } else {
                // Grace period exceeded
                logger.error('Offline grace period exceeded', {
                    daysExpired: Math.floor(daysExpired),
                    maxAllowed: maxOfflineGraceDays
                });
            }
        }
        
        // Expired - clear cache if online
        if (isOnline) {
            logger.warn('Clearing expired subscription cache');
            await keytar.deletePassword(SERVICE_NAME, STORE_CACHE_KEY);
            await keytar.deletePassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT);
        }
        
        return {
            success: true,
            isValid: false,
            status: 'expired',
            source: localSubscription.syncedFromServer ? 'server' : 'cache',
            signatureVerified: !isUnsignedCache,
            storeId: storeIdToUse,
            isOnline,
            message: `Subscription expired on ${expiresAt.toLocaleString()}. Please renew.`,
            expiresAt: expiresAt.toISOString(),
            requiresRenewal: true
        };
    }

    // ✅ Valid subscription
    const timeUntilExpiry = expiresAt.getTime() - currentTime.getTime();
    const timeUntilExpiryFormatted = formatTimeRemaining(timeUntilExpiry);
    
    logger.info('Valid subscription found', {
        storeId: storeIdToUse,
        plan: localSubscription.subscription?.plan,
        expiresAt: expiresAt.toLocaleString(),
        signed: !isUnsignedCache,
        source: localSubscription.syncedFromServer ? 'server' : 'cache'
    });

    const statusMessage = isOnline ? 
        `Subscription active until ${expiresAt.toLocaleString()}` :
        `Subscription active until ${expiresAt.toLocaleString()} (Offline mode - using cached data)`;

    return {
        success: true,
        isValid: true,
        status: 'active',
        source: localSubscription.syncedFromServer ? 'server' : 'cache',
        signatureVerified: !isUnsignedCache,
        unsignedCache: isUnsignedCache,
        storeId: storeIdToUse,
        isOnline,
        message: statusMessage + (isUnsignedCache ? ' [Unsigned cache - will migrate when online]' : ''),
        expiresAt: expiresAt.toISOString(),
        plan: localSubscription.subscription?.plan || localSubscription.plan,
        timeUntilExpiry: timeUntilExpiryFormatted,
        lastSyncedAt: localSubscription.cachedAt || localSubscription.lastSyncedAt,
        offlineMode: !isOnline,
        // ⚡ Additional metadata
        machineId: machineId,
        primaryMachineId: localSubscription.machineId
    };
};

// Helper function to format time remaining
const formatTimeRemaining = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} day${days !== 1 ? 's' : ''}, ${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}, ${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`;
    } else {
        return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
};

// FIXED getDeviceInfo function with proper store binding
const getDeviceInfo = () => {
    try {
        logger.debug('Generating device information');
        
        const fingerprint = generateFlexibleDeviceFingerprint();
        const now = new Date().toISOString();
        const machineId = getMachineId();
        
        // Create human-readable device name
        const hostname = os.hostname();
        const platform = os.platform();
        const deviceName = `${hostname}-${platform}`.substring(0, 50);
        
        // Get network information safely
        let primaryIP = 'Local Network';
        try {
            const interfaces = os.networkInterfaces();
            for (const [name, nets] of Object.entries(interfaces)) {
                for (const net of nets) {
                    if (net.family === 'IPv4' && !net.internal) {
                        primaryIP = `${name}: ${net.address}`;
                        break;
                    }
                }
                if (primaryIP !== 'Local Network') break;
            }
        } catch (error) {
            console.warn('Could not get network info:', error.message);
        }
        
        // Create comprehensive device info
        const deviceInfo = {
            // Essential identifiers
            terminalId: generateTerminalId(),
            fingerprint: fingerprint.fingerprint,
            fingerprintHmac: fingerprint.fingerprintHmac,
            machineId: machineId,
            
            // Display information
            name: deviceName,
            deviceType: 'desktop',
            status: 'active',
            
            // Timestamps
            registeredAt: now,
            lastLoginAt: now,
            
            // Network information
            ipAddress: primaryIP,
            
            // System information  
            osInfo: `${os.type()} ${os.release()} (${os.arch()})`,
            platform: platform,
            arch: os.arch(),
            
            // Hardware information (sanitized)
            motherboardInfo: fingerprint.raw?.motherboard || 'Hardware Info Available',
            cpuInfo: fingerprint.raw?.cpuModel || `${os.cpus()[0]?.model || 'Unknown CPU'} (${os.cpus().length} cores)`,
            
            // Memory information
            totalMemory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
            
            // Fingerprint metadata
            fingerprintStrength: fingerprint.strength,
            fingerprintScore: fingerprint.score,
            reliableComponents: fingerprint.reliable,
            
            // Additional context
            nodeVersion: process.version,
            generatedAt: now,

            // FIXED: Store binding information
            storeId: currentStoreId || null,
            storeBinding: currentStoreId ? {
                storeId: currentStoreId,
                bindingType: 'primary',
                bindingTimestamp: now
            } : null
        };
        
        logger.debug('Device information generated', {
            deviceName: deviceInfo.name,
            terminalId: deviceInfo.terminalId,
            storeId: deviceInfo.storeId || 'Not bound',
            fingerprintScore: deviceInfo.fingerprintScore
        });
        
        return deviceInfo;
        
    } catch (error) {
        logger.error('Error generating device info, using fallback', { error });
        
        // Comprehensive fallback device info
        const machineId = getMachineId();
        const now = new Date().toISOString();
        
        const fallbackDeviceInfo = {
            terminalId: generateTerminalId(),
            fingerprint: `fallback_${machineId.substring(0, 16)}`,
            fingerprintHmac: `hmac_${machineId.substring(0, 16)}`,
            machineId: machineId,
            
            name: `${os.hostname()}-${os.platform()}`,
            deviceType: 'desktop',
            status: 'active',
            
            registeredAt: now,
            lastLoginAt: now,
            
            ipAddress: 'Local Network (Fallback)',
            osInfo: `${os.type()} ${os.release()} (${os.arch()})`,
            platform: os.platform(),
            arch: os.arch(),
            
            motherboardInfo: 'Hardware Detection Failed',
            cpuInfo: `${os.cpus()[0]?.model || 'Unknown CPU'} (${os.cpus().length} cores)`,
            totalMemory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
            
            fingerprintStrength: 'fallback',
            fingerprintScore: 0,
            reliableComponents: 0,
            
            nodeVersion: process.version,
            generatedAt: now,
            fallbackMode: true,
            
            // FIXED: Store binding for fallback too
            storeId: currentStoreId || null,
            storeBinding: currentStoreId ? {
                storeId: currentStoreId,
                bindingType: 'primary',
                bindingTimestamp: now
            } : null
        };
        
        logger.debug('Using fallback device info:', {
            name: fallbackDeviceInfo.name,
            terminalId: fallbackDeviceInfo.terminalId,
            fallbackMode: true,
            storeId: fallbackDeviceInfo.storeId || 'Not bound'
        });
        
        return fallbackDeviceInfo;
    }
};

// Enhanced clear local subscription cache
const clearLocalSubscription = async () => {
    try {
        await keytar.deletePassword(SERVICE_NAME, SUBSCRIPTION_ACCOUNT);
        console.log('✅ Local subscription cache cleared');
        
        // Reset cache
        cachedSubscription = null;
        cacheExpiry = 0;
        lastLicenseCheckTime = 0;
        hasPerformedStartupSync = false;
        isOnlineCheckDone = false;
        
        return true;
    } catch (error) {
        console.warn('Could not clear local subscription:', error.message);
        return false;
    }
};

// Enhanced getSubscriptionPlans with better formatting
const getSubscriptionPlans = () => {
    return Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.displayName || plan.name,
        duration: plan.duration,
        durationHuman: formatTimeRemaining(plan.duration),
        maxDevices: plan.maxDevices,
        price: plan.price || 0,
        priceFormatted: plan.price ? `Rs. ${plan.price.toLocaleString()}` : 'Free',
        requiresCouchDB: plan.requiresCouchDB,
        lanSync: plan.lanSync,
        syncMode: plan.syncMode,
        planTier: plan.planTier,
        savings: plan.savings || null,
        description: plan.description,
        features: plan.features,
        recommended: key === 'MONTHLY_MULTI' // Mark multi-device as recommended
    }));
};

// Validation function for plan selection
const validatePlanSelection = (planId, deviceCount) => {
    const plan = SUBSCRIPTION_PLANS[planId];
    
    if (!plan) {
        return {
            valid: false,
            error: 'Invalid plan selected'
        };
    }
    
    // Check device count
    if (deviceCount > plan.maxDevices) {
        return {
            valid: false,
            error: `This plan supports up to ${plan.maxDevices} device(s). You need a multi-device plan.`
        };
    }
    
    // Check CouchDB requirement for multi-device
    if (deviceCount > 1 && !plan.requiresCouchDB) {
        return {
            valid: false,
            error: 'Multi-device setup requires a plan with CouchDB sync.'
        };
    }
    
    return {
        valid: true,
        plan: plan,
        message: `${plan.displayName} selected successfully`
    };
};

// FIXED savePendingLicenseRequest function - Remove problematic cooldown logic
const savePendingLicenseRequest = async (deviceInfo, userInfo, planType = 'TEST') => {
    const machineId = getMachineId();
    const now = Date.now();

    if (isRegistering) {
        logger.debug('Another registration in progress, waiting');
        let attempts = 0;
        while (isRegistering && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        
        if (isRegistering) {
            throw new Error('Registration timeout - another registration is taking too long');
        }
    }

    isRegistering = true;
    lastRegistrationTime = now;

    try {
        // ✅ FIX: Get API_BASE_URL at the START of the function
        const apiBaseUrl = configManager.get('API_BASE_URL');
        
        if (!apiBaseUrl) {
            throw new Error('API_BASE_URL not configured - please check your .env.production file');
        }

        const dbConnected = await checkDatabaseConnectivity();
        
        if (!dbConnected) {
            logger.warn('API server not accessible for license request');
            return {
                success: false,
                error: 'API server not accessible - please check your internet connection'
            };
        }

        const plan = SUBSCRIPTION_PLANS[planType];
        const currentDateTime = new Date().toISOString();

        const completeDeviceInfo = {
            ...deviceInfo,
            terminalId: deviceInfo.terminalId || generateTerminalId(),
            name: deviceInfo.name || `Device-${machineId.substring(0, 8)}`,
            deviceType: deviceInfo.deviceType || 'desktop',
            registeredAt: deviceInfo.registeredAt || currentDateTime,
            lastLoginAt: deviceInfo.lastLoginAt || currentDateTime,
            osInfo: deviceInfo.osInfo || `${os.type()} ${os.release()}`,
            platform: os.platform(),
            arch: os.arch(),
            ipAddress: deviceInfo.ipAddress || 'Local Network',
            fingerprint: deviceInfo.fingerprint || 'hardware_fingerprint_generated',
            fingerprintHmac: deviceInfo.fingerprintHmac || 'hmac_generated',
            // ENSURE store binding is included
            storeId: currentStoreId,
            storeName: userInfo.storeName || deviceInfo.storeName || 'Unknown Store'
        };

        logger.info('📤 Saving license request via API...', {
            deviceName: completeDeviceInfo.name,
            terminalId: completeDeviceInfo.terminalId,
            planType: planType,
            storeId: currentStoreId,
            apiUrl: apiBaseUrl
        });
        
        // ✅ Use axios without JWT for public registration endpoint
        logger.debug('Making registration request', {
            url: `${apiBaseUrl}/register-device`,
            storeId: currentStoreId,
            planType: planType
        });
        
        const response = await axios.post(
            `${apiBaseUrl}/register-device`,
            {
                deviceInfo: completeDeviceInfo,
                storeId: currentStoreId,
                planType: planType,
                userInfo: {
                    ...userInfo,
                    requestedBy: userInfo.requestedBy || 'device_user',
                    requestMethod: 'electron_app'
                }
            },
            {
                headers: { 
                    'Content-Type': 'application/json'
                },
                timeout: 30000,
                validateStatus: (status) => status < 500 // Accept 4xx responses
            }
        );
        
        logger.debug('Registration response received', {
            status: response.status,
            success: response.data?.success
        });
        
        if (!response.data || !response.data.success) {
    const errorMsg = response.data?.error || response.data?.message || 'Registration failed';
    logger.error('Registration failed', {
        status: response.status,
        error: errorMsg,
        data: response.data
    });
    throw new Error(errorMsg);
}

const responseData = response.data;
const requestId = responseData.requestId;

if (!requestId) {
    logger.error('No requestId in response', { responseData });
    throw new Error('Server did not return a request ID');
}

// ✅ CRITICAL FIX: Store temporary JWT token if provided
if (responseData.tempToken) {
    try {
        logger.info('📥 Storing temporary registration token from server');
        
        // Store using the token manager
        await jwtTokenManager.storeTemporaryToken(responseData.tempToken);
        
        // Store metadata about registration
        const registrationData = {
            requestId: requestId,
            storeId: currentStoreId,
            deviceId: completeDeviceInfo.terminalId,
            registeredAt: currentDateTime,
            status: 'pending',
            hasToken: true
        };
        
        await keytar.setPassword(
            'PharmAssistPOS',
            'registration-metadata',
            JSON.stringify(registrationData)
        );
        
        logger.info('✅ Registration token stored successfully', {
            requestId: requestId,
            storeId: currentStoreId,
            canAccessAPI: true
        });
        
    } catch (tokenError) {
        logger.error('Failed to store registration token', { 
            error: tokenError.message,
            requestId: requestId
        });
        
        // Don't fail registration if token storage fails
        // but warn user
    }
} else {
    logger.warn('⚠️ No temporary token in registration response - API access may be limited', {
        requestId: requestId,
        responseKeys: Object.keys(responseData)
    });
}

logger.info('✅ License request saved successfully', {
    requestId: requestId,
    deviceName: completeDeviceInfo.name,
    plan: plan.name,
    status: responseData.status || 'pending',
    hasToken: !!responseData.tempToken
});

return {
    success: true,
    requestId: requestId,
    deviceInfo: completeDeviceInfo,
    requestedPlan: {
        type: planType,
        name: plan.name,
        duration: plan.duration,
        durationHuman: formatTimeRemaining(plan.duration),
        maxDevices: plan.maxDevices
    },
    createdAt: currentDateTime,
    status: responseData.status || 'pending',
    message: responseData.message || 'Registration pending approval',
    hasAuthToken: !!responseData.tempToken,
    apiAccessEnabled: !!responseData.tempToken,
    displayInfo: {
        deviceName: completeDeviceInfo.name,
        terminalId: completeDeviceInfo.terminalId,
        requestTime: new Date(currentDateTime).toLocaleString(),
        planName: plan.name,
        status: responseData.status || 'Pending Approval'
    }
};
        
    } catch (error) {
        logger.error('Error saving license request', {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        
        // Provide better error messages
        if (error.code === 'ECONNREFUSED') {
            throw new Error('Cannot connect to license server - please check your internet connection');
        } else if (error.code === 'ETIMEDOUT') {
            throw new Error('License server request timed out - please try again');
        } else if (error.response?.status === 404) {
            throw new Error('License server endpoint not found - please update your application');
        } else {
            throw new Error(error.message || 'Failed to register device');
        }
    } finally {
        isRegistering = false;
    }
};

/**
 * Clear subscription cache ONLY - preserves JWT tokens for API access
 * Use this for testing or when you want to force re-fetch from server
 */
const clearSubscriptionCacheOnly = async () => {
    try {
        const keytar = require('keytar');
        const SERVICE_NAME = 'PharmAssistPOS';
        
        logger.info('🧹 Clearing subscription cache (preserving authentication)');
        
        // ONLY clear subscription-related caches
        const subscriptionKeys = [
            'subscription-data',
            SUBSCRIPTION_ACCOUNT,
            `store-subscription-${currentStoreId}`,
            'device-registration-cache',
            'registration-metadata'
        ];
        
        let clearedCount = 0;
        for (const key of subscriptionKeys) {
            try {
                await keytar.deletePassword(SERVICE_NAME, key);
                clearedCount++;
                logger.debug(`Cleared cache: ${key}`);
            } catch (e) {
                // Key doesn't exist, ignore
            }
        }
        
        // ✅ PRESERVED (NOT cleared):
        // - 'jwt-access-token'      -> Needed for API authentication
        // - 'jwt-refresh-token'     -> Needed to refresh access token
        // - 'temp-registration-token' -> Needed for pending registrations
        // - 'device-registration'   -> Device identity
        
        // Reset in-memory cache
        cachedSubscription = null;
        cacheExpiry = 0;
        lastLicenseCheckTime = 0;
        
        logger.info(`✅ Subscription cache cleared (${clearedCount} items, auth preserved)`);
        
        return { 
            success: true, 
            clearedCount,
            authPreserved: true,
            message: 'Subscription cache cleared. API access preserved.' 
        };
        
    } catch (error) {
        logger.error('Failed to clear subscription cache', { error });
        return { success: false, error: error.message };
    }
};

/**
 * Clear EVERYTHING including auth tokens - use for complete reset/logout
 * WARNING: This will require re-registration or re-login
 */
const clearAllCachesAndTokens = async () => {
    try {
        const keytar = require('keytar');
        const SERVICE_NAME = 'PharmAssistPOS';
        
        logger.warn('🗑️ FULL RESET: Clearing ALL caches AND authentication tokens');
        
        // Clear ALL caches including auth
        const allKeys = [
            // Subscription caches
            'subscription-data',
            SUBSCRIPTION_ACCOUNT,
            `store-subscription-${currentStoreId}`,
            'device-registration-cache',
            'registration-metadata',
            
            // Device identity
            'device-registration',
            
            // JWT tokens (this breaks API access)
            'jwt-access-token',
            'jwt-refresh-token',
            'temp-registration-token',
            'jwt-token-metadata'
        ];
        
        let clearedCount = 0;
        for (const key of allKeys) {
            try {
                await keytar.deletePassword(SERVICE_NAME, key);
                clearedCount++;
            } catch (e) {
                // Ignore
            }
        }
        
        // Reset all state
        cachedSubscription = null;
        cacheExpiry = 0;
        lastLicenseCheckTime = 0;
        hasPerformedStartupSync = false;
        isOnlineCheckDone = false;
        
        logger.warn(`⚠️ Full reset complete (${clearedCount} items cleared)`);
        logger.warn('⚠️ Device will need to re-register or re-login');
        
        return { 
            success: true, 
            clearedCount,
            fullReset: true,
            requiresReauth: true,
            message: 'Complete reset performed. Re-authentication required.' 
        };
        
    } catch (error) {
        logger.error('Failed to perform full reset', { error });
        return { success: false, error: error.message };
    }
};

/**
 * Diagnostic function - show what's cached
 */
const getCacheStatus = async () => {
    try {
        const keytar = require('keytar');
        const SERVICE_NAME = 'PharmAssistPOS';
        
        const checkKey = async (key) => {
            try {
                const value = await keytar.getPassword(SERVICE_NAME, key);
                return !!value;
            } catch {
                return false;
            }
        };
        
        const status = {
            subscription: {
                subscriptionData: await checkKey('subscription-data'),
                storeSubscription: await checkKey(`store-subscription-${currentStoreId}`),
                deviceCache: await checkKey('device-registration-cache')
            },
            authentication: {
                accessToken: await checkKey('jwt-access-token'),
                refreshToken: await checkKey('jwt-refresh-token'),
                tempToken: await checkKey('temp-registration-token')
            },
            device: {
                registration: await checkKey('device-registration'),
                metadata: await checkKey('registration-metadata')
            }
        };
        
        const tokenStatus = await jwtTokenManager.getTokenStatus();
        
        return {
            success: true,
            cacheStatus: status,
            tokenStatus: tokenStatus,
            apiAccessAvailable: tokenStatus.hasAccessToken || tokenStatus.hasTempToken,
            storeId: currentStoreId
        };
        
    } catch (error) {
        logger.error('Failed to get cache status', { error });
        return { success: false, error: error.message };
    }
};


// ✅ FIXED createSubscription function - Properly handle device info and return data
const createSubscription = async (planType = 'TEST', userInfo = {}) => {
    logger.logOperation('CREATE SUBSCRIPTION', { planType });
    
    let deviceInfo;
    try {
        deviceInfo = getDeviceInfo();
        logger.debug('Device info generated for subscription', {
            terminalId: deviceInfo.terminalId,
            storeId: deviceInfo.storeId
        });
    } catch (error) {
        logger.error('Failed to get device info, using fallback', { error });
        // Create minimal fallback device info
        deviceInfo = {
            terminalId: generateTerminalId(),
            name: `Device-${getMachineId().substring(0, 8)}`,
            deviceType: 'desktop',
            registeredAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            fingerprint: 'fallback_fingerprint',
            ipAddress: 'Local Network',
            osInfo: `${os.type()} ${os.release()}`
        };
    }
    
    const plan = SUBSCRIPTION_PLANS[planType];
    
    if (!plan) {
        throw new Error(`Invalid plan: ${planType}`);
    }

    try {
        const enhancedUserInfo = {
            ...userInfo,
            requestedBy: userInfo.requestedBy || 'device_user',
            requestMethod: 'electron_desktop_app',
            requestedAt: new Date().toISOString()
        };

        logger.debug('Submitting license request');
        
        const result = await savePendingLicenseRequest(deviceInfo, enhancedUserInfo, planType);
        
        if (result.success) {
            logger.info('Subscription request created successfully', {
                requestId: result.requestId,
                planName: plan.name,
                storeId: currentStoreId
            });
        }
        
        return {
            success: true,
            requestId: result.requestId,
            message: `${plan.name} subscription request created successfully`,
            deviceInfo: result.deviceInfo,
            requestedPlan: result.requestedPlan,
            createdAt: result.createdAt,
            // ✅ Include display-friendly data for frontend
            displayData: {
                deviceName: result.displayInfo?.deviceName || deviceInfo.name,
                terminalId: result.displayInfo?.terminalId || deviceInfo.terminalId,
                requestTime: result.displayInfo?.requestTime || new Date().toLocaleString(),
                planName: result.displayInfo?.planName || plan.name,
                status: 'Pending Approval'
            }
        };
        
    } catch (error) {
        logger.error('Subscription creation failed', { error });
        throw error;
    }
};

// SIMPLIFIED main workflow:
const verifyLicense = async (forceServerCheck = false) => {
    logger.debug('Verifying license', { forceServerCheck });
    
    try {
        const subscriptionStatus = await checkSubscriptionWithSignatureVerification(forceServerCheck);
        
        if (subscriptionStatus.isValid) {
            logger.info('Valid subscription verified', {
                status: subscriptionStatus.status,
                storeId: subscriptionStatus.storeId
            });
            return {
                success: true,
                licensed: true,
                subscription: subscriptionStatus
            };
        } else {
            logger.warn('Invalid subscription', {
                status: subscriptionStatus.status,
                reason: subscriptionStatus.message
            });
            return {
                success: false,
                licensed: false,
                subscription: subscriptionStatus,
                allowPlanSelection: true
            };
        }
    } catch (error) {
        logger.error('License verification failed', { error });
        throw error;
    }
};

const refreshLicense = async () => {
    logger.info('Refreshing subscription license');
    return await verifyLicense(true);
};

const testDatabaseConnection = async () => {
    logger.logOperation('API CONNECTION TEST');
    
    try {
        const API_BASE_URL = configManager.get('API_BASE_URL');
        
        logger.debug('Testing API health endpoint');
        const response = await axios.get(`${API_BASE_URL}/health`, {
            timeout: 10000
        });
        
        logger.info('API connection test successful', {
            status: response.status,
            data: response.data
        });
        
        return {
            success: true,
            tests: {
                apiConnection: true,
                healthCheck: response.data
            }
        };
        
    } catch (error) {
        logger.error('API connection test failed', { error });
        
        return {
            success: false,
            error: error.message,
            details: {
                status: error.response?.status,
                statusText: error.response?.statusText
            }
        };
    }
};

module.exports = {
    generateFlexibleDeviceFingerprint,
    validateFlexibleFingerprint,
    verifyLicense,
    refreshLicense,
    getDeviceInfo,
    getMachineId,
    generateTerminalId,

    createSubscription,
    checkSubscription: checkSubscriptionWithSignatureVerification,
    clearLocalSubscription,
    getSubscriptionPlans,
    checkDatabaseConnectivity,
    testDatabaseConnection,
    // forceLogout,
    performStartupSync,
    licenseEventEmitter,
    SUBSCRIPTION_PLANS,
    getPlansByCategory,
    validatePlanSelection,
    HARDWARE_COMPONENT_WEIGHTS,
    MIN_HARDWARE_SCORE,
    // ADD: Store binding methods
    setStoreId,
    getStoreId,
    validateStoreBinding,
    // ✅ Safe cache clearing (preserves auth)
    clearSubscriptionCache: clearSubscriptionCacheOnly,
    
    // ⚠️ Dangerous full reset (clears everything)
    clearAllCachesAndTokens: clearAllCachesAndTokens,
    
    // 📊 Diagnostics
    getCacheStatus: getCacheStatus,
    
    // Backward compatibility (maps to safe version)
    clearLocalSubscription: clearSubscriptionCacheOnly,
    
    // Old function renamed for clarity
    clearAllCachedTokens: clearAllCachesAndTokens,

    // PERFORMANCE IMPROVEMENT: Export cleanup function
    cleanup: () => {
        if (axiosInstance) {
            // Clear any pending requests
            axiosInstance = null;
        }
        // Reset all caches
        cachedSubscription = null;
        cacheExpiry = 0;
        lastLicenseCheckTime = 0;
        connectionStatus = null;
        connectionCheckTime = 0;
        hasPerformedStartupSync = false;
        isOnlineCheckDone = false;
        console.log('🧹 License service cleanup completed');
    }
};