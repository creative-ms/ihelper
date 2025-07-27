// utils/imageUtils.js - Centralized image URL handling with authentication

export class CouchDBImageUtils {
  static DB_URL = 'http://localhost:5984/products';
  static DB_AUTH = { username: 'admin', password: 'mynewsecretpassword' };

  /**
   * Generate authenticated CouchDB image URL
   * @param {string} productId - Product document ID
   * @param {string} attachmentName - Image attachment filename
   * @returns {string|null} - Authenticated image URL or null
   */
  static getImageUrl(productId, attachmentName) {
    if (!productId || !attachmentName) {
      return null;
    }

    try {
      // Encode the attachment name to handle special characters
      const encodedAttachment = encodeURIComponent(attachmentName);
      
      // Create base64 encoded auth string
      const authString = btoa(`${this.DB_AUTH.username}:${this.DB_AUTH.password}`);
      
      // Construct URL with embedded authentication
      const baseUrl = `${this.DB_URL}/${productId}/${encodedAttachment}`;
      
      // For CouchDB, we need to handle auth via headers, not URL params
      // Return the base URL and handle auth separately
      return {
        url: baseUrl,
        headers: {
          'Authorization': `Basic ${authString}`
        }
      };
    } catch (error) {
      console.error('Error constructing image URL:', error);
      return null;
    }
  }

  /**
   * Create a blob URL from CouchDB image with proper authentication
   * @param {string} productId - Product document ID
   * @param {string} attachmentName - Image attachment filename
   * @returns {Promise<string|null>} - Blob URL or null
   */
  static async createAuthenticatedImageUrl(productId, attachmentName) {
    const imageData = this.getImageUrl(productId, attachmentName);
    if (!imageData) return null;

    try {
      const response = await fetch(imageData.url, {
        method: 'GET',
        headers: imageData.headers,
        mode: 'cors',
        credentials: 'include'
      });

      if (!response.ok) {
        console.warn(`Failed to fetch image: ${response.status} ${response.statusText}`);
        return null;
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Error creating authenticated image URL:', error);
      return null;
    }
  }

  /**
   * Preload and cache image URLs for better performance
   * @param {Array} products - Array of product objects
   * @returns {Promise<Map>} - Map of productId -> blob URL
   */
  static async preloadImages(products) {
    const imageCache = new Map();
    const imagePromises = [];

    products.forEach(product => {
      if (product._id && product.imageAttachmentName) {
        const promise = this.createAuthenticatedImageUrl(product._id, product.imageAttachmentName)
          .then(blobUrl => {
            if (blobUrl) {
              imageCache.set(product._id, blobUrl);
            }
          })
          .catch(error => {
            console.warn(`Failed to preload image for ${product._id}:`, error);
          });
        
        imagePromises.push(promise);
      }
    });

    // Wait for all images to load (or fail)
    await Promise.allSettled(imagePromises);
    
    console.log(`✅ Preloaded ${imageCache.size} images`);
    return imageCache;
  }

  /**
   * Clean up blob URLs to prevent memory leaks
   * @param {Map|Array} blobUrls - Blob URLs to revoke
   */
  static cleanupBlobUrls(blobUrls) {
    if (blobUrls instanceof Map) {
      blobUrls.forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
      blobUrls.clear();
    } else if (Array.isArray(blobUrls)) {
      blobUrls.forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  /**
   * Validate if an image attachment exists in CouchDB
   * @param {string} productId - Product document ID
   * @param {string} attachmentName - Image attachment filename
   * @returns {Promise<boolean>} - True if image exists
   */
  static async validateImageExists(productId, attachmentName) {
    const imageData = this.getImageUrl(productId, attachmentName);
    if (!imageData) return false;

    try {
      const response = await fetch(imageData.url, {
        method: 'HEAD', // Only check headers, don't download
        headers: imageData.headers,
        mode: 'cors',
        credentials: 'include'
      });

      return response.ok;
    } catch (error) {
      console.warn(`Image validation failed for ${productId}/${attachmentName}:`, error);
      return false;
    }
  }

  /**
   * Debug function to test image accessibility
   * @param {Array} products - Array of products to test
   */
  static async debugImageAccess(products) {
    console.log('🔍 Testing CouchDB image accessibility...');
    
    for (const product of products) {
      if (product.imageAttachmentName && product._id) {
        const exists = await this.validateImageExists(product._id, product.imageAttachmentName);
        const imageData = this.getImageUrl(product._id, product.imageAttachmentName);
        
        console.log(
          `${exists ? '✅' : '❌'} ${product.name}: ${imageData?.url || 'No URL'}`
        );
      }
    }
  }
}

// Updated ProductRow component with fixed image handling
export const ProductRowWithAuth = ({ 
  product, 
  isSelected, 
  onToggleSelection, 
  onEdit, 
  onDelete,
  onImageView,
  calculateFinalPrice,
  getStockStatus 
}) => {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef(null);
  const loadingRef = useRef(false);

  const finalSellingPrice = useMemo(() => calculateFinalPrice(product), [product, calculateFinalPrice]);
  const stockStatus = useMemo(() => getStockStatus(product.totalQuantity || 0), [product.totalQuantity, getStockStatus]);

  // Load authenticated image
  useEffect(() => {
    if (!product._id || !product.imageAttachmentName || loadingRef.current) {
      return;
    }

    let mounted = true;
    loadingRef.current = true;

    const loadImage = async () => {
      try {
        const blobUrl = await CouchDBImageUtils.createAuthenticatedImageUrl(
          product._id, 
          product.imageAttachmentName
        );
        
        if (mounted && blobUrl) {
          setImageUrl(blobUrl);
          setImageError(false);
        } else if (mounted) {
          setImageError(true);
        }
      } catch (error) {
        console.warn(`Failed to load image for ${product.name}:`, error);
        if (mounted) {
          setImageError(true);
        }
      } finally {
        loadingRef.current = false;
      }
    };

    // Use Intersection Observer for lazy loading
    if (imgRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !imageLoaded && !imageError && !loadingRef.current) {
              loadImage();
              observer.disconnect();
            }
          });
        },
        { threshold: 0.1 }
      );

      observer.observe(imgRef.current);
      
      return () => {
        mounted = false;
        observer.disconnect();
        // Cleanup blob URL
        if (imageUrl && imageUrl.startsWith('blob:')) {
          URL.revokeObjectURL(imageUrl);
        }
      };
    }
  }, [product._id, product.imageAttachmentName]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const handleDelete = useCallback(() => {
    if (window.confirm(`Are you sure you want to delete "${product.name}"?`)) {
      onDelete(product);
    }
  }, [product, onDelete]);

  const handleEdit = useCallback(() => onEdit(product), [product, onEdit]);
  const handleToggle = useCallback(() => onToggleSelection(product._id), [product._id, onToggleSelection]);
  const handleImageClick = useCallback(() => onImageView(product), [product, onImageView]);

  return (
    <tr className={`hover:bg-cyan-50/50 dark:hover:bg-slate-700/50 transition-all duration-200 ${
      isSelected ? 'bg-cyan-50 dark:bg-slate-700' : ''
    }`}>
      <td className="py-4 px-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="w-4 h-4 text-cyan-600 bg-white dark:bg-slate-700 rounded focus:ring-cyan-500 dark:focus:ring-cyan-400"
        />
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div 
              ref={imgRef}
              className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center overflow-hidden border-2 border-slate-200 dark:border-slate-600 group-hover:border-cyan-300 dark:group-hover:border-cyan-500 transition-colors"
            >
              {imageUrl && imageLoaded && !imageError ? (
                <img
                  src={imageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  onLoad={handleImageLoad}
                  onError={() => setImageError(true)}
                  loading="lazy"
                />
              ) : loadingRef.current ? (
                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <PhotoIcon className="w-8 h-8 text-slate-400" />
              )}
            </div>
            {imageUrl && !imageError && (
              <button
                onClick={handleImageClick}
                className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
              >
                <EyeIcon className="w-6 h-6 text-white" />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base mb-1 truncate">
              {product.name}
            </h3>
            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span className="bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-md font-mono text-xs">
                {product.sku || 'No SKU'}
              </span>
              {product.barcode && (
                <span className="text-xs truncate max-w-[100px]">
                  {product.barcode}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300">
          {product.category || 'Uncategorized'}
        </span>
      </td>
      <td className="py-4 px-4">
        <div className="space-y-1">
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
            PKR {finalSellingPrice.toFixed(2)}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Base: PKR {Number(product.retailPrice || 0).toFixed(2)}
          </div>
          {product.discountRate > 0 && (
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
              {product.discountRate}% OFF
            </div>
          )}
        </div>
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2">
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${stockStatus.color}`}>
            {stockStatus.status === 'out' && <ExclamationTriangleIcon className="w-4 h-4 mr-1" />}
            {stockStatus.status === 'in' && <CheckCircleIcon className="w-4 h-4 mr-1" />}
            {stockStatus.status === 'low' && <ExclamationTriangleIcon className="w-4 h-4 mr-1" />}
            {product.totalQuantity || 0}
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {stockStatus.text}
        </div>
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={handleEdit}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-900/50 transition-colors"
            title="Edit Product"
          >
            <PencilSquareIcon className="w-4 h-4 mr-1" />
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            title="Delete Product"
          >
            <TrashIcon className="w-4 h-4 mr-1" />
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};