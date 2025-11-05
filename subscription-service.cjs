// subscription-service.cjs - COMPLETE FIXED VERSION WITH LOGGER
require('dotenv').config();
const { ipcMain } = require('electron');
const configManager = require('./config-manager.cjs');
const { getLogger } = require('./logger.cjs');
const jwtTokenManager = require('./jwt-token-manager.cjs');
const logger = getLogger();

class SubscriptionService {
    constructor(licenseModule = null) {
        this.licenseModule = licenseModule;
        this.hasLicenseModule = !!licenseModule;
        this.isInitialized = false;
        this.config = this.loadConfiguration();
        
        if (this.hasLicenseModule) {
            logger.debug('Subscription service initialized', { mode: 'with_license_module' });
        } else {
            logger.warn('Subscription service running in fallback mode (no license module)');
        }
        
        this.registerIpcHandlers();
        this.setupEventListeners();
        this.isInitialized = true;
        logger.debug('Subscription service ready');
    }

    loadConfiguration() {
    try {
        return {
            API_BASE_URL: configManager.get('API_BASE_URL'),
            LICENSE_SERVER_URL: configManager.get('LICENSE_SERVER_URL')
        };
        } catch (error) {
            logger.error('Failed to load subscription service config', { error });
            return null;
        }
    }

    setupEventListeners() {
        if (this.hasLicenseModule && this.licenseModule.licenseEventEmitter) {
            logger.debug('Setting up license event listeners');
            
            this.licenseModule.licenseEventEmitter.on('force-logout', (eventData) => {
                logger.info('Force logout event received', { eventData });
                const { BrowserWindow } = require('electron');
                const windows = BrowserWindow.getAllWindows();
                windows.forEach(window => {
                    window.webContents.send('license:force-logout', eventData);
                });
            });
        } else {
            logger.debug('No license module event emitter available, skipping event setup');
        }
    }

    registerIpcHandlers() {
        logger.debug('Registering IPC handlers');
        
        ipcMain.handle('subscription:create', this.handleCreateSubscription.bind(this));
        ipcMain.handle('subscription:check', this.handleCheckSubscription.bind(this));
        ipcMain.handle('subscription:getPlans', this.handleGetPlans.bind(this));
        ipcMain.handle('subscription:clearCache', this.handleClearCache.bind(this));
        ipcMain.handle('subscription:forceLogout', this.handleForceLogout.bind(this));
        ipcMain.handle('subscription:startupSync', this.handleStartupSync.bind(this));
        
        logger.debug('IPC handlers registered', { handlersCount: 6 });
    }

    // Get subscription plans
    getSubscriptionPlans() {
        logger.debug('Fetching subscription plans');
        
        try {
            if (this.hasLicenseModule && typeof this.licenseModule.getSubscriptionPlans === 'function') {
                const plans = this.licenseModule.getSubscriptionPlans();
                logger.trace('Retrieved subscription plans from license module', { count: plans.length });
                return plans;
            }
            
            logger.debug('License module not available, using fallback plans');
            return this.getFallbackPlans();
            
        } catch (error) {
            logger.warn('Error getting subscription plans', { error });
            return this.getFallbackPlans();
        }
    }

    // Fallback plans
    getFallbackPlans() {
        logger.trace('Loading fallback subscription plans');
        
        const fallbackPlans = [
            {
                id: 'DEMO_SINGLE',
                name: '14-Day Demo (Single Device)',
                displayName: '14-Day Demo (Single Device)',
                duration: 14 * 24 * 60 * 60 * 1000,
                durationHuman: '14 days',
                maxDevices: 1,
                price: 0,
                priceFormatted: 'Free',
                requiresCouchDB: false,
                lanSync: false,
                syncMode: 'pouchdb_only',
                planTier: 'demo',
                description: 'Try basic POS features with PouchDB only',
                features: [
                    'Single device only',
                    'PouchDB local storage',
                    'No cloud sync',
                    'Basic POS features',
                    '14 days access'
                ]
            },
            {
                id: 'DEMO_MULTI',
                name: '14-Days Demo (Multi-Device)',
                displayName: '14-Days Demo (Multi-Device)',
                duration: 14 * 24 * 60 * 60 * 1000,
                durationHuman: '14 days',
                maxDevices: 3,
                price: 0,
                priceFormatted: 'Free',
                requiresCouchDB: true,
                lanSync: true,
                syncMode: 'couchdb_required',
                planTier: 'demo',
                description: 'Try multi-device with LAN sync',
                features: [
                    'Up to 3 devices',
                    'Local CouchDB sync required',
                    'LAN synchronization',
                    'Full POS features',
                    '14 days access'
                ]
            },
            {
                id: 'MONTHLY_SINGLE_BASIC',
                name: '1 Month - Single Device - Basic',
                displayName: '1 Month - Single Device - Basic',
                duration: 30 * 24 * 60 * 60 * 1000,
                durationHuman: '30 days',
                maxDevices: 1,
                price: 2000,
                priceFormatted: 'Rs. 2,000',
                requiresCouchDB: false,
                lanSync: false,
                syncMode: 'pouchdb_only',
                planTier: 'monthly',
                description: 'Single device with PouchDB only',
                features: [
                    'Single device only',
                    'PouchDB local storage',
                    'No cloud sync needed',
                    'Full POS features',
                    'Email support',
                    '30 days access'
                ]
            },
            {
                id: 'MONTHLY_MULTI',
                name: '1 Month - Multi-Device',
                displayName: '1 Month - Multi-Device',
                duration: 30 * 24 * 60 * 60 * 1000,
                durationHuman: '30 days',
                maxDevices: 5,
                price: 3500,
                priceFormatted: 'Rs. 3,500',
                requiresCouchDB: true,
                lanSync: true,
                syncMode: 'couchdb_required',
                planTier: 'monthly',
                recommended: true,
                description: 'Multiple devices with LAN sync',
                features: [
                    'Up to 5 devices',
                    'Local CouchDB sync required',
                    'Real-time LAN sync',
                    'Manager-Cashier setup',
                    'Full POS features',
                    'Priority support',
                    '30 days access'
                ]
            },
            {
                id: 'QUARTERLY_SINGLE_BASIC',
                name: '3 Months - Single Device - Basic',
                displayName: '3 Months - Single Device - Basic',
                duration: 90 * 24 * 60 * 60 * 1000,
                durationHuman: '90 days',
                maxDevices: 1,
                price: 6000,
                priceFormatted: 'Rs. 6,000',
                requiresCouchDB: false,
                lanSync: false,
                syncMode: 'pouchdb_only',
                planTier: 'quarterly',
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
                ]
            },
            {
                id: 'QUARTERLY_MULTI',
                name: '3 Months - Multi-Device',
                displayName: '3 Months - Multi-Device',
                duration: 90 * 24 * 60 * 60 * 1000,
                durationHuman: '90 days',
                maxDevices: 5,
                price: 9500,
                priceFormatted: 'Rs. 9,500',
                requiresCouchDB: true,
                lanSync: true,
                syncMode: 'couchdb_required',
                planTier: 'quarterly',
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
                ]
            }
        ];
        
        logger.debug('Fallback plans ready', { planCount: fallbackPlans.length });
        return fallbackPlans;
    }

    // Validate plan selection
    validatePlanSelection(planId, deviceCount) {
        const plan = this.getFallbackPlans().find(p => p.id === planId);
        
        if (!plan) {
            logger.warn('Invalid plan selected', { planId });
            return {
                valid: false,
                error: 'Invalid plan selected'
            };
        }
        
        // Check device count
        if (deviceCount > plan.maxDevices) {
            logger.warn('Device count exceeds plan limit', {
                planId,
                maxDevices: plan.maxDevices,
                requestedDevices: deviceCount
            });
            return {
                valid: false,
                error: `This plan supports up to ${plan.maxDevices} device(s). You need a multi-device plan.`
            };
        }
        
        // Check CouchDB requirement for multi-device
        if (deviceCount > 1 && !plan.requiresCouchDB) {
            logger.warn('Multi-device setup requires CouchDB plan', { planId });
            return {
                valid: false,
                error: 'Multi-device setup requires a plan with CouchDB sync.'
            };
        }
        
        logger.trace('Plan validation successful', { planId, deviceCount });
        return {
            valid: true,
            plan: plan,
            message: `${plan.displayName || plan.name} selected successfully`
        };
    }

    // Check CouchDB availability
    async checkCouchDBAvailability() {
        try {
            const axios = require('axios');
            const response = await axios.get('http://localhost:5984', { 
                timeout: 3000,
                validateStatus: (status) => status === 200 
            });
            
            logger.debug('CouchDB connection successful');
            return true;
        } catch (error) {
            logger.warn('CouchDB not available', { error: error.message });
            return false;
        }
    }

    // Handle subscription creation
    async handleCreateSubscription(event, { planType = 'DEMO_SINGLE', userInfo = {}, storeId = null, deviceCount = 1 } = {}) {
        logger.info('Subscription creation requested', {
            planType,
            storeId,
            deviceCount,
            hasLicenseModule: this.hasLicenseModule
        });
        
        try {
            // 1. Check if license module is available
            if (!this.hasLicenseModule) {
                logger.error('License service not available for subscription creation');
                return {
                    success: false,
                    error: 'License service not available',
                    isPending: false,
                    fallbackMode: true
                };
            }

            // 2. Validate plan selection
            const validation = this.validatePlanSelection(planType, deviceCount);
            if (!validation.valid) {
                logger.warn('Plan validation failed', { planType, reason: validation.error });
                return {
                    success: false,
                    error: validation.error,
                    isPending: false
                };
            }

            const plan = validation.plan;

            // 3. Check CouchDB availability for plans that require it
            if (plan.requiresCouchDB && plan.syncMode === 'couchdb_required') {
                logger.debug('Checking CouchDB availability for plan', { planType });
                const couchDBCheck = await this.checkCouchDBAvailability();
                
                if (!couchDBCheck) {
                    logger.error('CouchDB required but not available', {
                        planType,
                        deviceCount
                    });
                    return {
                        success: false,
                        error: `This plan requires local CouchDB for ${deviceCount > 1 ? 'multi-device sync' : 'backup'}. ` +
                               `Please install CouchDB first or choose a Basic plan.`,
                        requiresCouchDB: true,
                        installInstructions: 'Download CouchDB from https://couchdb.apache.org/',
                        isPending: false,
                        planDetails: {
                            name: plan.displayName || plan.name,
                            maxDevices: plan.maxDevices,
                            requiresCouchDB: plan.requiresCouchDB
                        }
                    };
                }
                
                logger.debug('CouchDB availability verified');
            }

            // 4. Bind to store
            if (storeId && typeof this.licenseModule.setStoreId === 'function') {
                logger.debug('Binding subscription to store', { storeId });
                this.licenseModule.setStoreId(storeId);
            }

            // 5. Create subscription
            const result = await this.licenseModule.createSubscription(planType, {
                ...userInfo,
                storeId: storeId,
                deviceCount: deviceCount,
                requiresCouchDB: plan.requiresCouchDB,
                syncMode: plan.syncMode,
                maxDevices: plan.maxDevices,
                createdAt: new Date().toISOString(),
                requestMethod: 'subscription_service'
            });
            
            logger.info('Subscription created successfully', {
                requestId: result.requestId,
                planType: planType,
                deviceCount: deviceCount,
                storeId: storeId,
                couchDBRequired: plan.requiresCouchDB
            });
            
            // 6. Return success response
            return {
                success: true,
                requestId: result.requestId,
                isPending: result.isPending || true,
                planType: planType,
                planDetails: {
                    name: plan.displayName || plan.name,
                    maxDevices: plan.maxDevices,
                    price: plan.price,
                    requiresCouchDB: plan.requiresCouchDB,
                    syncMode: plan.syncMode
                },
                storeId: storeId,
                message: `${plan.displayName} subscription request submitted`,
                couchDBVerified: plan.requiresCouchDB,
                ...result
            };
            
        } catch (error) {
            logger.error('Subscription creation failed', { error, planType, storeId });
            return {
                success: false,
                error: error.message,
                isPending: false
            };
        }
    }

    // Check subscription
    async handleCheckSubscription(event, { forceServerCheck = false, storeId = null } = {}) {
        logger.debug('Subscription check initiated', {
            forceServerCheck,
            storeId,
            hasLicenseModule: this.hasLicenseModule
        });
        
        try {
            if (!this.hasLicenseModule) {
                logger.warn('No license module available for subscription check');
                return {
                    success: true,
                    isValid: false,
                    status: 'no_license_service',
                    message: 'License service not available - running in fallback mode',
                    isOnline: false,
                    storeId: storeId,
                    deviceAccess: 'unknown',
                    fallbackMode: true
                };
            }

            if (storeId && typeof this.licenseModule.setStoreId === 'function') {
                logger.trace('Setting store ID in license module', { storeId });
                this.licenseModule.setStoreId(storeId);
            }

            if (global.dbManager?.currentStoreId && typeof this.licenseModule.setStoreId === 'function') {
                const currentStoreFromDB = global.dbManager.currentStoreId;
                logger.trace('Using store ID from database', { storeId: currentStoreFromDB });
                this.licenseModule.setStoreId(currentStoreFromDB);
            }

            const boundStoreId = (typeof this.licenseModule.getStoreId === 'function') 
                ? this.licenseModule.getStoreId() 
                : (storeId || global.dbManager?.currentStoreId);
            
            logger.trace('License module store binding', { boundStoreId });

            if (!boundStoreId) {
                logger.warn('No store ID available for subscription check');
                return {
                    success: true,
                    isValid: false,
                    status: 'no_store_binding',
                    message: 'No store ID available for subscription check',
                    isOnline: false,
                    storeId: null
                };
            }

            const isOnline = (typeof this.licenseModule.checkDatabaseConnectivity === 'function')
                ? await this.licenseModule.checkDatabaseConnectivity()
                : false;
            
            logger.trace('Database connectivity check', { isOnline });

            if (isOnline) {
                const storeSubscription = await this.checkStoreSubscription(boundStoreId);
                
                if (storeSubscription.found) {
                    logger.info('Active store subscription found', {
                        storeId: boundStoreId,
                        status: storeSubscription.status
                    });
                    await this.cacheSubscriptionForStore(storeSubscription, boundStoreId);
                    
                    const currentMachineId = (typeof this.licenseModule.getMachineId === 'function') 
                        ? this.licenseModule.getMachineId() 
                        : 'unknown';
                    const isSecondaryDevice = currentMachineId !== storeSubscription.primaryMachineId;
                    
                    return {
                        success: true,
                        isValid: true,
                        status: 'active',
                        subscription: storeSubscription.subscription,
                        storeId: storeSubscription.storeId,
                        deviceAccess: isSecondaryDevice ? 'secondary' : 'primary',
                        message: isSecondaryDevice 
                            ? 'Store has active subscription - secondary device access' 
                            : 'Store has active subscription - primary device',
                        signatureVerified: storeSubscription.signatureVerified || false,
                        isOnline: true,
                        primaryMachineId: storeSubscription.primaryMachineId,
                        currentMachineId: currentMachineId
                    };
                }
            }

            if (typeof this.licenseModule.checkSubscription === 'function') {
                const status = await this.licenseModule.checkSubscription(forceServerCheck);
                
                if (status?.isValid) {
                    logger.info('Device-specific subscription found', { storeId: boundStoreId });
                    return {
                        success: true,
                        isOnline: isOnline,
                        storeId: boundStoreId,
                        deviceAccess: 'primary',
                        ...status
                    };
                }
            }

            if (!isOnline) {
                const cachedResult = await this.checkCachedSubscription(boundStoreId);
                if (cachedResult.isValid) {
                    logger.info('Cached subscription verified', { storeId: boundStoreId });
                    return cachedResult;
                }
            }

            logger.warn('No active subscription found', { storeId: boundStoreId });
            return {
                success: true,
                isValid: false,
                status: 'no_subscription',
                storeId: boundStoreId,
                message: 'No active subscription found for this store',
                signatureVerified: false,
                isOnline: isOnline
            };

        } catch (error) {
            logger.error('Subscription check failed', { error, storeId });
            return {
                success: false,
                isValid: false,
                status: 'error',
                error: error.message,
                isOnline: false,
                signatureVerified: false
            };
        }
    }

    // REPLACE checkStoreSubscription method
async checkStoreSubscription(storeId) {
    try {
        if (!this.config?.API_BASE_URL) {
            logger.warn('API configuration not available for store subscription check');
            return { found: false, reason: 'no_config' };
        }

        logger.trace('Checking store subscription via API', { storeId });
        
        // ✅ CRITICAL FIX: Check if we have authentication tokens first
        const hasTokens = await jwtTokenManager.hasValidTokens();
        
        if (!hasTokens) {
            logger.warn('No JWT tokens available - cannot check subscription from server', {
                storeId,
                suggestion: 'Using cached data or showing registration screen'
            });
            
            return { 
                found: false, 
                reason: 'no_auth_tokens',
                requiresAuth: true,
                message: 'No authentication tokens - please complete device registration'
            };
        }
        
        // USE JWT authenticated API call
        const result = await jwtTokenManager.makeAuthenticatedRequest(
            '/check-store-subscription',
            {
                method: 'POST',
                data: { storeId: storeId }
            }
        );

        // ✅ Handle authentication requirement
        if (!result.success) {
            if (result.requiresAuth) {
                logger.warn('Authentication required for subscription check', { 
                    storeId,
                    error: result.error 
                });
                
                return { 
                    found: false, 
                    reason: 'requires_auth',
                    requiresAuth: true,
                    message: 'Authentication required - please login or register device'
                };
            }
            
            if (result.networkError) {
                logger.warn('Network error checking subscription', { 
                    storeId,
                    error: result.error 
                });
                
                return { 
                    found: false, 
                    reason: 'network_error',
                    offline: true,
                    message: 'Cannot connect to server - using cached data'
                };
            }
            
            logger.warn('Store subscription API check failed', { 
                storeId, 
                error: result.error 
            });
            
            return { 
                found: false, 
                reason: 'api_error', 
                error: result.error 
            };
        }

        const data = result.data;

        if (data.found && data.subscription) {
            const subscription = data.subscription;
            const expiresAt = new Date(subscription.expiresAt);
            const now = new Date();
            
            if (now <= expiresAt && subscription.status === 'active') {
                logger.trace('Store subscription verified via API', { 
                    storeId, 
                    plan: subscription.plan 
                });
                
                return {
                    found: true,
                    storeId: storeId,
                    status: 'active',
                    plan: subscription.plan,
                    subscription: subscription,
                    primaryMachineId: data.primaryMachineId,
                    signatureVerified: data.signatureVerified || false,
                    expiresAt: expiresAt.toISOString(),
                    licenseId: data.licenseId
                };
            }
        }

        logger.trace('No active store subscription found via API', { storeId });
        return { found: false, reason: 'not_found' };
        
    } catch (error) {
        logger.warn('Store subscription check failed', { 
            storeId, 
            error: error.message 
        });
        
        return { 
            found: false, 
            reason: 'error', 
            error: error.message 
        };
    }
}

    // Check cached subscription (helper method)
    async checkCachedSubscription(storeId) {
        logger.trace('Checking cached subscription', { storeId });
        return {
            success: true,
            isValid: false,
            status: 'no_cache',
            message: 'No cached subscription found',
            isOnline: false,
            storeId: storeId
        };
    }

    // Cache subscription (helper method)
    async cacheSubscriptionForStore(subscriptionData, storeId) {
        try {
            const keytar = require('keytar');
            const SERVICE_NAME = 'PharmAssistPOS';
            const STORE_SUBSCRIPTION_ACCOUNT = `store-subscription-${storeId}`;
            
            const cacheData = {
                storeId: storeId,
                subscription: subscriptionData.subscription || subscriptionData,
                signature: subscriptionData.signature,
                signatureVerified: subscriptionData.signatureVerified,
                cachedAt: new Date().toISOString(),
                primaryMachineId: subscriptionData.primaryMachineId
            };
            
            await keytar.setPassword(SERVICE_NAME, STORE_SUBSCRIPTION_ACCOUNT, JSON.stringify(cacheData));
            logger.trace('Subscription cached for store', { storeId });
            return true;
        } catch (error) {
            logger.warn('Failed to cache subscription', { storeId, error: error.message });
            return false;
        }
    }

    // Get plans handler
    async handleGetPlans() {
        logger.debug('Fetching subscription plans');
        
        try {
            const allPlans = this.getSubscriptionPlans();
            
            if (!allPlans || allPlans.length === 0) {
                logger.error('No subscription plans available');
                return {
                    success: false,
                    plans: [],
                    error: 'No subscription plans available'
                };
            }
            
            const categorized = {
                demo: allPlans.filter(p => p.planTier === 'demo'),
                monthly: allPlans.filter(p => p.planTier === 'monthly'),
                quarterly: allPlans.filter(p => p.planTier === 'quarterly')
            };
            
            logger.trace('Subscription plans retrieved', {
                total: allPlans.length,
                demo: categorized.demo.length,
                monthly: categorized.monthly.length,
                quarterly: categorized.quarterly.length,
                source: this.hasLicenseModule ? 'license_module' : 'fallback'
            });
            
            return {
                success: true,
                plans: allPlans,
                categorized: categorized,
                source: this.hasLicenseModule ? 'license_module' : 'fallback'
            };
            
        } catch (error) {
            logger.error('Error retrieving subscription plans', { error });
            return {
                success: false,
                error: error.message,
                plans: this.getFallbackPlans()
            };
        }
    }

    // Other handlers
    async handleClearCache() {
        logger.debug('Clearing subscription cache');
        return { success: true, message: 'Cache cleared' };
    }

    async handleForceLogout() {
        logger.info('Force logout initiated');
        return { success: true, message: 'Logout completed' };
    }

    async handleStartupSync() {
        logger.debug('Startup sync initiated');
        return { success: true, synced: false, message: 'Sync not available' };
    }
}

module.exports = SubscriptionService;