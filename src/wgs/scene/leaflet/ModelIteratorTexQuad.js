import { isMobileDevice, getGlobal } from "../../../compat";
import { tile2Index, index2Tile, TileCoords } from './TileCoords';
import { SortedList } from '../SortedList';
import { LmvMatrix4 } from '../LmvMatrix4';
import { UVTransform, GeometryManager } from './TexQuadUtils';
import * as THREE from "three";
import { logger } from "../../../logger/Logger";
import { SceneMath } from "../SceneMath";
import { createShaderMaterial } from "../../render/ShaderUtils";
import { LeafletShader } from "../../render/LeafletShader";

var TileState_Missing = 0;
var TileState_Loading = 1;
var TileState_Loaded  = 2;

const _document = getGlobal().document;

var TileInfo = function(timeStamps, mesh) {

    this.timeStamps = timeStamps;       // {number} frame timeStamp of last usage (per view) 
    this.mesh      = mesh;              // {THREE.Mesh}
    this.state     = TileState_Missing;
};

// @param {THREE.Vector3} camPos
// @param {THREE.Vector3} camDir - must be normalized
// @param {THREE.Vector3} bboxMin
// @param {THREE.Vector3} bboxMax
// @returns {Number} Projected z-distance of a bbox from the camera
function projectedBoxDistance(camPos, camDir, boxMin, boxMax) {
    // compute the point within bbox that is nearest to p by clamping against box
    var nearest = camPos.clone();
    nearest.max(boxMin);
    nearest.min(boxMax);

    return nearest.sub(camPos).dot(camDir);
}

export function TexQuadConfig() {
    this.urlPattern   = null; // string pattern for image URLs, e.g., http://otile1.mqcdn.com/tiles/1.0.0/sat/{z}/{x}/{y}.jpg
    this.tileSize     = null; // in;  width/height of tile images (always squared) in pixels. E.g., 256
    this.maxLevel     = null; // int; maximum hierarchy level, e.g., 10    
    this.skippedLevels= [];   // Assume all levels are present

    this.textureLoader = null; // user-provided function for loading images

    // texture extent at max resolution. Must be integer between 1 and 2^(maxLevel)
    this.texWidth  = 0; 
    this.texHeight = 0;

    // Restrict number of tiles that are forced keep in memory at once. As a minimum, we only keep in memory
    // what we need to display the currently visible tiles. Higher values allow to spend more memory
    // on prefetching tiles.
    this.maxActiveTiles = (isMobileDevice() ? 0 : 400);

    // LRU cache size (given as max number of tiles)
    this.cacheSize = (isMobileDevice() ? 0 : 150);

    // {function()} optional callback that is triggered when the root image is loaded.
    // This is used when loading single images (maxLevel=0), where we obtain texWidth, texHeight, and tileSize
    // are obtained from the image dimensions.
    this.onRootLoaded = null;

    // In this code, root level 0 contains is defined as the largest miplevel for which whole image fits into a single tile. The translation service
    // currently produces additional levels with smaller mipmaps of this single tiles, which we don't use here. E.g., the actual root tile of our hierarchy
    // might be in a folder "9" instead of "0". Therefore, whenever we do image load requests, we add this level offset to the tile level to derive the image URL.
    this.levelOffset = 0;

    this.getRootTileSize = function() {
        // the root tile covers a squared pixel region of size tileSize * 2^maxLevel
        return 1.0 * (this.tileSize << this.maxLevel);
    };

    this.getQuadWidth    = function() { return this.scale * this.texWidth   / this.getRootTileSize(); };
    this.getQuadHeight   = function() { return this.scale * this.texHeight  / this.getRootTileSize(); };

    /** @returns {LmvMatrix4} Converts from quad geometry coords to paper units. */
    this.getPageToModelTransform = function(paperWidth, paperHeight) {

        // scale from page to model units
        var sx = paperWidth  / this.getQuadWidth();
        var sy = paperHeight / this.getQuadHeight();

        return new LmvMatrix4(true).set(
            sx,  0, 0, 0,
            0,  sy, 0, 0,
            0,   0, 1, 0,
            0,   0, 0, 1
        );
    };

    // The root tile corresponds to [0,1] in x/y. The actual image may be smaller.
    this.getBBox = function() {
        
        // the image dimensions determine which fraction of the root tile is actually used.
        var quadWidth  = this.getQuadWidth();
        var quadHeight = this.getQuadHeight();

        if (this.fitPaperSize) {
            return new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(quadWidth, quadHeight, 0.0));
        } else {
            // If quadHeight is <1.0, it means that not the full root tile height is used by the image.
            // Since pixel y and worldY directions are opposite, the unused part of the [0,1] region is at 
            // the lower end of the y-range. 
            var cropYShift = (1.0 - quadHeight);
            return new THREE.Box3(new THREE.Vector3(0,cropYShift,0), new THREE.Vector3(quadWidth, 1.0, 0.0));
        }
    };

    this.valid = function() {
        return (typeof this.urlPattern  == 'string'  && this.urlPattern.length>0 && 
                typeof this.tileSize    == 'number'  && this.tileSize>0  &&
                typeof this.maxLevel    == 'number'  && this.maxLevel>0  &&
                typeof this.texWidth    == 'number'  && this.texWidth>0  &&
                typeof this.texHeight   == 'number'  && this.texHeight>0);
    };

    /** Configures the iterator to display a single image file without leaflet hierarchy.
     *  For this case, the image dimensions are not known in advance, but set as soon as 
     *  the root tile is loaded. 
     *   @params {string}     imagePath
     *   @params {function()} [onImageLoaded] Called as soon as the root has been loaded and 
     *                        the image dimensions are available.
     */
    this.initForSimpleImage = function(imagePath) {
        
        // The urlPattern read from bubble may have been URL encoded.
        // This can happen if the bubble comes from EMEA data center.
        this.urlPattern  = decodeURIComponent(imagePath);
        this.maxLevel    = 0;
        this.levelOffset = 0;

        this.scale = 1.0;

        // indicate that these values are not available yet.
        // The iterator will set them based on the image extensions as soon as it is loaded
        this.tileSize  = -1;
        this.texWidth  = -1;
        this.texHeight = -1;

        this.isSimpleImage = true;
    };

    this.isLevelPresent = function(level) {
        return !this.skippedLevels[level];
    };

    // Returns the required maxLevel for a given texture resolution.
    // All params are int.
    function computeMaxLevel(w, h, tileSize) {

        // compute maxLevel that we would get for 1x1 resolution at level 0
        var lx = Math.ceil(Math.log2(w));
        var ly = Math.ceil(Math.log2(h));
        var maxLevel = Math.max(lx, ly);

        // since the actual root tile has tileSize x tileSize, we subtract the skipped levels.
        return maxLevel - Math.log2(tileSize);
    }

    // If a maxLevel is specified that is smaller than the one that we computed for the given
    // resolution, texWidth and texHeight must be set to the smaller resolution at this level.
    function applyMaxLevel(config, actualMaxLevel, restrictedMaxLevel) {
        // Find the next lower level that hasn't been skipped.
        while (restrictedMaxLevel > 0 && config.skippedLevels[restrictedMaxLevel])
            --restrictedMaxLevel;
        var levelDiff = actualMaxLevel - restrictedMaxLevel;
        if (levelDiff > 0) {
            config.texWidth  >>= levelDiff;
            config.texHeight >>= levelDiff;
            config.maxLevel = restrictedMaxLevel;
        }
    }

    // Find the levels that are really present in the zip file
    function findSkippedLevels(config) {
        var skipped = [];
        if (config.zips) {
            // We will match the url exactly, except allow numbers for {x} {y} {z}
            // First make sure the url is properly escaped for regex.        
            exp = config.urlPattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // Now match {x} and {y} with a number
            exp = exp.replace(/\\{x\\}/, '[0-9]+');
            exp = exp.replace(/\\{y\\}/, '[0-9]+');
            // Now match {z} with a number and capture it
            exp = exp.replace(/\\{z\\}/, '([0-9]+)');
            // Now create the regex that completely matches exp
            var exp = new RegExp('^' + exp + '$');

            // Initialize the skipped levels. Assume no levels are present
            skipped.length = config.maxLevel + 1;
            skipped.fill(true);

            var present = 0;    // Count the number of levels present

            // Search the zip file tables for matching files
            config.zips.forEach(function(curZip) {
                Object.keys(curZip.fileTable).forEach(function(key) {
                    var match = exp.exec(key);
                    // If we got a match, then process it
                    if (match && match[1]) {
                        var index = parseInt(match[1]) - config.levelOffset;
                        // make sure the match is within the range we want
                        if (index >= 0 && index <= config.maxLevel) {
                            skipped[index] = false;
                            ++present;
                        }
                    }
                });
            });

            if (present === 0) {
                skipped.length = 0;
                logger.info('No leaflet levels found - assume all are present');
            }
        }
        return skipped;
    }

    /** Extracts all required params from a given options dictionary.
     * @param {string} urlPattern
     * @param {Object} loadOptions Parameter dictionary
     * @param {function} textureLoader User-provided function for loading image resources.
     * @param {Object} [options] The object that contains loadOptions. Pass optionally to update with texture size aftewards.
     *                           (e.g. for simple images)
     *   The function has the following signature: function(imageURL, onSuccess, onError).
     *   In case of success, `onSuccess` callback should be called with the texture as a single argument.
     *   In case of failure, `onError` callback should be called with a description of the error.
     */
    this.initFromLoadOptions = function(urlPattern, loadOptions, textureLoader, options) {
        
        // The urlPattern read from bubble may have been URL encoded.
        // This can happen if the bubble comes from EMEA data center.
        this.urlPattern   = decodeURIComponent(urlPattern);
        this.textureLoader = textureLoader;
        this.options = options;

        if (loadOptions) {
            this.tileSize     = loadOptions.tileSize;
            this.maxLevel     = computeMaxLevel(loadOptions.texWidth, loadOptions.texHeight, loadOptions.tileSize);
            this.texWidth     = loadOptions.texWidth;
            this.texHeight    = loadOptions.texHeight;
            this.levelOffset  = loadOptions.levelOffset;
            this.zips         = loadOptions.zips;

            // If paperWidth or paperHeight are not supported, we can't fit paper size.
            // This can happen when loading an image that doesn't have a bubble.
            const fitPaperSizeSupported = !!(loadOptions.paperWidth && loadOptions.paperHeight);
            this.fitPaperSize = loadOptions.fitPaperSize && fitPaperSizeSupported;
            this.paperHeight = loadOptions.paperHeight;
            this.scale = this.fitPaperSize ? loadOptions.paperWidth * this.getRootTileSize() / this.texWidth : 1.0;

            this.skippedLevels = findSkippedLevels(this);

            // If maxLevel is specified, scale down texSize to the resolution at this level
            if (typeof loadOptions.maxLevel == 'number') {
                applyMaxLevel(this, this.maxLevel, loadOptions.maxLevel);
            }

            // allow to override default memory settings via load options
            this.maxActiveTiles = loadOptions.maxActiveTiles || this.maxActiveTiles;
            this.cacheSize      = loadOptions.cacheSize      || this.cacheSize;
        } else if (this.options) {
            this.options.loadOptions = {}; // Make sure there's an object to return the values
        }
    };
}

/** @classDesc Produces a quad that is textured with a large image. 
 *             The image is stored as a hierarchy of image tiles, where each tile is stored as a separate file (e.g. jpg or png).
 *             Each hierarchy level represents a miplevel of the overall texture, subdivided into squared tiles 
 *             of fixed size (e.g., 256 x 256). Level 0 contains a single tile that represents the whole texture as a single tile at lowest resolution.
 *             At the leaf level n, the texture is represented at full resolution as a tile grid of up to (2^n x 2^n) tiles. 
 *
 *             Note that some tiles may be unused or cropped if the overall resolution is not squared and a pow2-multiple of the tilesize.
 *             
 * @class 
 *   @param {TexQuadConfig}   config
 *   @param {MaterialManager} materials
 */
export function ModelIteratorTexQuad(config, materials) {

    //Set this in order to avoid a hard dependency to this class from RenderModel's getLeaflet() function.
    this.isModelIteratorTexQuad = true;

    var _config = config;

    var _dpiScale  = 1; // In case of comparison between files with different dpi's

    // The bbox of the quad keeps the same, because it is independent on how we subdivide the quad geometry.
    // However, for single images, its correct initialization will be deferred until the image is loaded.
    var _bbox = config.getBBox();

    // reused scene (per view) that we reconfigure on each iterator reset.
    var _scenes = [];

    // For setting a model transform
    let _matrix = null, _invMatrix = null;
    const _matrixWithoutScale = new THREE.Matrix4();
    const _invMatrixWithoutScale = new THREE.Matrix4();
    const _identity = new THREE.Matrix4();
    const _pos    = new THREE.Vector3();
    const _rotate = new THREE.Quaternion();
    const _scale = new THREE.Vector3();
    const _tmpFrustum = new Autodesk.Viewing.Private.FrustumIntersector();
    let _scaleX = 1;
    let _scaleY = 1;
    let _transformedCamera; // Placeholder camera to avoid creating a new one

    // To support theming
    const _defaultTheming = new THREE.Vector4(0, 0, 0, 0);
    const _themingColor = new THREE.Vector4().copy(_defaultTheming);

    // For selection
    let _modelId = 0;

    // {MaterialManager}
    var _materials = materials;

    // View bounds - Box3
    var _viewBounds = null;

    // Disable cutplanes
    var _doNotCut = false;

    // Is model ghosted or fully visible
    var _isGhosted = false;

    // Is model selected
    var _isSelected = false;
    var _selectionColor = new THREE.Color(); // Initial color is set when calling highlightSelection for the first time.

    // This iterator returns only a single scene. Therefore, _done is set to false when on iteration start (this.reset()) 
    // and set to true again after first call of nextBatch. 
    var _done = []; // bool per view index

    // array of TileInfos for all tiles that are currently available for rendering.
    // caching of generated tiles. Tiles are addressed by int indices
    // computed by tile2Index (see TileCoords.js)
    var _tiles = [];

    // increased with each iterator reset. used for LRU timestamps.
    var _timeStamps = []; // managed separately per viewer

    var _SelectionColorAlpha = 0.6;

    // Allocates a separate view, for which reset/getScene can be called independently.
    // Make sure to call unregister when not using anymore - to avoid leaking resources.
    // @returns {number} index of the new view. 
    this.registerView = function() {
        // find first free view index
        var viewIndex = _scenes.indexOf(undefined);
        if (viewIndex === -1) {
            viewIndex = _scenes.length;
        }

        // acquire new scene and timestamp
        var scene = new THREE.Scene();

        // In order to support alpha maps (png), fading is done inside the Leaflet shader, instead of
        // using the common materialOverride like every other model when it is ghosted.
        scene.ignoreFadeMaterial = true;
        // matrix will contain the placement transform (much like in FragmentList), while
        // matrixWorld will contain the combination of this placement and the model transform that
        // is applied when aligning models
        if (_config.placementTransform) {
            scene.matrix.copy(_config.placementTransform);
        }
        scene.matrixAutoUpdate = false;
        _scenes[viewIndex] = scene;
        _timeStamps[viewIndex] = 0;
        _done[viewIndex] = true;

        return viewIndex;
    };
    
    // Default view 0 is always registered
    this.registerView();

    // for each update cycle, we track the number of tiles for which we updated the timeStamp.
    // The purpose of this is to control the memory consumption, because all active tiles are
    // kept in memory and protected from cache cleanup.
    var _numActiveTiles = 0;

    // used to limit the number of simultaneously loaded tiles
    var _maxRequests = 5;
    var _numRequests = 0; // currently running requests

    // For each frame, limit the number of new textures that enter the scene.
    // Otherwise, texture decode/upload in FireFlyRenderer may take too long.
    var _maxTextureUpdatesPerFrame = 5;

    // used to trigger redraw when new tiles are loaded
    var _needsRedraw = false;

    // each callback is called once when the scene is fully refined.
    var _onRefinedCallbacks = [];

    // Shared THREE.Geometry. A unit quad in xy plane with uv coords. Used for all tiles.
    var _quadGeom = null;

    var _aggressivePrefetching = false;

    var gm = new GeometryManager();
    
    // get image resolution at a given hierarchy level. We have full resolution at maxLevel and reduce it by half with each level.
    function getMipmapWidth(level) {
        var levelDiff = _config.maxLevel - level;
        return _config.texWidth >> levelDiff;
    }
    function getMipmapHeight(level) {
        var levelDiff = _config.maxLevel - level;
        return _config.texHeight >> levelDiff;
    }

    // returns true if the pixel region of the tile is outside the given image dimensions.
    //  @param {TileCoords} tile
    //  @returns {bool}
    function tileOutside(tile) {
        // get dimensions
        var levelWidth  = getMipmapWidth(tile.level);
        var levelHeight = getMipmapHeight(tile.level);

        // compute minPixel of the tile's pixel region
        var minPixelX = tile.x * _config.tileSize;
        var minPixelY = tile.y * _config.tileSize;

        return (minPixelX >= levelWidth || minPixelY >= levelHeight);
    }

    // The width/height of a mipLevel cannot be assumed to be a multiple of tileSize. Therefore, tiles containing the image boundary 
    // are cropped to the relevant pixels. E.g., the width of a boundary tile might be 500 while the tileSize is 512.
    // Since the image is cropped, we have to scale down the geometry as well to avoid stretching. This function contains the scale
    // factor in x/y to be applied to the geometry.
    //
    // @returns {THREE.Vector2} 
    function getCropScale(tile) {
        // get dimensions
        var levelWidth  = getMipmapWidth(tile.level);
        var levelHeight = getMipmapHeight(tile.level);
    
        // compute first minPixel covered by this tile
        var minPixelX = tile.x * _config.tileSize;
        var minPixelY = tile.y * _config.tileSize;
        
        // crop tile to image dimensions
        var croppedWidth  = Math.max(0, Math.min(_config.tileSize, levelWidth  - minPixelX));
        var croppedHeight = Math.max(0, Math.min(_config.tileSize, levelHeight - minPixelY));

        var ts = 1.0 * _config.tileSize;

        return new THREE.Vector2(croppedWidth/ts, croppedHeight/ts);
    }

    /**
     * Sets aggressive prefetching mode. When enabled more tiles will be retrieved on each reset.
     * @param {boolean} enable
     */
    this.setAggressivePrefetching = function(enable) {
        _aggressivePrefetching = enable;
    };

    this.getScene = function(viewIndex) {
        viewIndex = viewIndex || 0;
        return _scenes[viewIndex];
    };

    this.getModelMatrix = function() {
        return _matrix;
    };

    this.getInverseModelMatrix = function() {
        if (_matrix) {
            if (!_invMatrix) {
                _invMatrix = _matrix.clone().invert();
            }

            return _invMatrix;
        }

        return null;
    };

    this.setModelMatrix = function(matrix) {
        if (matrix) {
            _matrix = _matrix || new THREE.Matrix4();
            _matrix.copy(matrix);
        } else {
            _matrix = null;
        }
        _invMatrix = null;
    };

    /** @returns {THREE.Scene|null} */
    this.nextBatch = function(viewIndex) {

        viewIndex = viewIndex || 0;

        // first call since reset => return _scene 
        if (!_done[viewIndex]) {
            _done[viewIndex] = true;

            // Needed in order to support transparency.
            // If the model is ghosted, render it last (with lower priority than other opaque scenes).
            _scenes[0].renderImportance = _isGhosted ? -1.0 : undefined;

            return _scenes[0];
        }
        return null;
    };

    this.getSceneCount = function() {
        // TexQuadIterators are always rendered as a single batch
        return 1;
    };

    /** @returns {bool} */
    this.done = function(viewIndex) { return _done[viewIndex || 0]; };

    /** Perform raycast on the quad. 
      * @param {THREE.RayCaster} raycaster
      * @param {Object[]}        intersects - An object array that contains intersection result objects.
      *                                       Each result r stores properties like r.point, r.fragId, r.dbId. (see VBIntersector.js for details)
      */
    this.rayCast = function(raycaster, intersects) {

        // not implemented yet
        return null;
    };

    /** Copies visible bbox into the given output params. Since per-fragment visibility is not supported
     *  by this iterator, both bboxes are always identical.
     *
     *   @param {THREE.Box3} [visibleBounds]
     *   @param {THREE.Box3} [visibleBoundsWithHidden]
     */  
    this.getVisibleBounds = function (visibleBounds, visibleBoundsWithHidden) {
        let box = _bbox;

        // Fit to the minimum box (intersection) of the original bounding box and visible bounds.
        if (_viewBounds) {
            box = box.clone().intersect(_viewBounds);
        }

        if (visibleBounds) {
            visibleBounds.copy(box);
            _config.placementTransform && visibleBounds.applyMatrix4(_config.placementTransform);
            _matrix && visibleBounds.applyMatrix4(_matrix);
        }
        if (visibleBoundsWithHidden) {
            visibleBoundsWithHidden.copy(box);
            _config.placementTransform && visibleBoundsWithHidden.applyMatrix4(_config.placementTransform);
            _matrix && visibleBoundsWithHidden.applyMatrix4(_matrix);
        }
    };

    this.setViewBounds = function (bounds) {
        _viewBounds = bounds;
        _materials.setViewportBoundsForModel(_modelId, _viewBounds);
    };

    this.getViewBounds = function () {
        return _viewBounds;
    };

    this.setDoNotCut = function (doNotCut) {
        return _doNotCut = doNotCut;
    };

    this.getDoNotCut = function () {
        return _doNotCut;
    };

    // compute width/height of a tile, assuming that the root corresponds to [0,1]^2 in xy.
    // level is int.
    function getTileScale(level) { return _config.scale / (1<<level); }

    // Given a tile to be rendered and a (n-th-order) parent from which we use the material,
    // this method computes offset and scale in uv coords that we need to compute the texture coords.
    //  @returns {UVTransform}
    function getUVOffsetAndScale(tile, parentTile) {

        // compute the level difference between tile and parent
        var levelDiff = tile.level - parentTile.level;

        // at tile.level, compute the number of tiles in x and y that share the same parent tile
        var levelDiffScale = (1<<levelDiff);

        // compute width/height in uv-space
        var uvScaleX = 1.0 / levelDiffScale;
        var uvScaleY = uvScaleX;

        // uvScale means here: "which extent in the uv-space of the parent corresponds to a the size of a single tile at tile.level"
        // If the parent tile is cropped, the uvScale needs to be upscaled accordingly.        
        var parentCropScale = getCropScale(parentTile);
        uvScaleX /= parentCropScale.x; // Note that cropScale.x and cropScale.y are always >0. Otherwise, the whole parent tile would 
        uvScaleY /= parentCropScale.y; // be outside the image extent and it wouldn't make sense to compute any uv coords.

        // For l=tile.level, find the minimum x and y among all subtiles of parent at level l.
        var firstX = parentTile.x * levelDiffScale;
        var firstY = parentTile.y * levelDiffScale;

        // compute offsetX/Y within the subtile grid of size [levelDiffScale]^2
        var offsetX = tile.x - firstX;
        var offsetY = tile.y - firstY;

        // uvScale as computed above is the size of a full tile at tile.level, given in uv space of the parent.
        // If the (child) tile is cropped, its geometry will be cropped as well, so that its extent is less than a full tile
        // at this level. Therefore, we have to consider the cropScale of the tile for the final scale factor.
        var cropScale = getCropScale(tile);
        
        // transform offset from tile-grid to uv
        offsetX *= uvScaleX;
        offsetY *= uvScaleY;

        // apply y-flip. Note that a simple y-flip (1.0-val) swaps min/max v-value of the tile.
        // E.g., the uv-offset of the first tile would be 1.0 after the swap - which should actually 
        // the max-v of the tile. Since offset has to be the min-uv, we have to subtract the
        // v-extent of the tile afterwards.
        offsetY = 1.0 - offsetY - (uvScaleY * cropScale.y);

        var result = new UVTransform();
        result.offsetX = offsetX;
        result.offsetY = offsetY;
        result.scaleX  = uvScaleX * cropScale.x;
        result.scaleY  = uvScaleY * cropScale.y;
        return result;
    }

    // tile: TileCoords
    // Returns: float
    function getTileMinX(tile) {
        var tileScale = getTileScale(tile.level);

        return tileScale * tile.x * _dpiScale;
    }

    // see getTileMinX
    function getTileMinY(tile) {
        var tileScale = getTileScale(tile.level);
        var top = _config.fitPaperSize ? _config.paperHeight : 1.0;
        return (top - (tile.y + 1) * tileScale * _dpiScale);
    }

    // @returns {TileInfo|null}
    function getTileInfo(tile) {
        return _tiles[tile2Index(tile)];
    }

    // Returns a true if a tile texture is in memory
    function tileLoaded(tile) {
        var tileInfo = getTileInfo(tile);
        return (tileInfo instanceof TileInfo) && tileInfo.state === TileState_Loaded;
    }

    // Finds a parent tile for which a texture is a available
    // Takes and returns TileCoord (or null if nothing found)
    //  @param {bool} [disableNewTextures] if true, we enforce to use a texture that
    //                                     has been used before and doesn't need to be decoded/uloaded anymore.
    function findLoadedParent(tile, disableNewTextures) {

        // step up the parent path until we find one in memory
        var parent   = tile.getParent();
        while(parent) {
            var info = getTileInfo(parent);

            // tile loaded?
            var found = (info && info.state === TileState_Loaded);
            
            // if loaded, are we allowed to use the texture?
            if (found && disableNewTextures) {

                // don't allow adding new tiles. Just the root is always accepted.
                if (info.mesh.material.map.needsUpdate && parent.level>0) {
                    found = false;
                }
            }
        
            // stop if we found a usable parent
            if (found) {
                break;
            }

            // Continue with next parent. Latest at the root,
            // we will usually succeed.
            parent = parent.getParent();
        }

        return parent;        
    }

    // creates a single quad shape (THREE.Mesh) representing a tile of the image.
    // If no image is provided, we use the material of a lower-resolution tile.
    function createTileShape(
        tile,              // TileCoords
        material,          // THREE.Material
        disableNewTextures // If material is null, this optional flag enforces that
                           // we use a fallback texture that does not require decode/upload
    ) {
        var geom;
        // for tiles with own texture, we can use the shared quad shape
        if (material) {
            // create shared quad geom on first use
            if (!_quadGeom) {
                _quadGeom = gm.createQuadGeom();
            }

            geom = _quadGeom;
            
        } else {
            // share texture of lower-resolution tile

            // if we have no image, find a parent tile from which we can reuse the material as a fallback
            var parentTile = findLoadedParent(tile);

            // by construction, parent is the first parent with texture 
            // in memory. So, parentShape must always be available.            
            var parentShape = getTileShape(parentTile);

            material = parentShape.material;

            // configure uv transform, because we are only using a subset of 
            // the texture for this tile
            var tmp = getUVOffsetAndScale(tile, parentTile);

            geom = gm.acquireQuadGeom(tmp);
        }

        var mesh = new THREE.Mesh(geom, material);
        mesh.tile = tile;
        mesh.modelId = _modelId;
        mesh.themingColor = _themingColor;

        var tileScale   = getTileScale(tile.level);

        // for boundary tiles with cropped images, scale down geometry accordingly. No effect for non-cropped tiles.
        var cropScaleFactor = getCropScale(tile);

        // since pixel y and worldY directions are opposite, y-cropped tiles also needs to be shifted.
        var cropYShift = (1.0 - cropScaleFactor.y) * tileScale * _dpiScale;

        // compute offset and scale of the tile, where [0,1]^2 corresponds to the root
        var tileOffsetX = getTileMinX(tile);
        var tileOffsetY = getTileMinY(tile);
        mesh.position.set(tileOffsetX, tileOffsetY + cropYShift, 0.0);
        mesh.scale.set(tileScale * cropScaleFactor.x * _dpiScale, tileScale * cropScaleFactor.y * _dpiScale, 1.0);

        // Update offset and scale in the Leaflet shader.
        material.uniforms['offsetRepeat'].value.set(material.map.offset.x, material.map.offset.y, material.map.repeat.x, material.map.repeat.y);

        return mesh;
    } 

    // Returns the URL string to request a single tile image
    function getTileTextureURL(tile) {
 
        var levelOffset = (_config.levelOffset ? _config.levelOffset : 0);

        var url = _config.urlPattern
            .replace("{x}", tile.x)
            .replace("{y}", tile.y)
            .replace("{z}", (tile.level + levelOffset));
        return url;
    }

    var resizeToPow2 = function(tex) {
        var image = tex.image;
        // First figure out what size we need and whether it is OK.
        var w = 1; while ((w *= 2) < image.width);
        var h = 1; while ((h *= 2) < image.height);
        if (w === image.width && h === image.height)
            return;

        // Need to resize. We resize by placing the image at the top left;
        // extending the edges to the edge of the new size; and
        // adjusting the texture transform to compensate for the new texture size.
        var canvas = _document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        var data = context.getImageData(0, 0, w, h);
        var array = new Uint32Array(data.data.buffer, 0, w * h);

        var i, j;
        if (image.height < h) {
            // first extend on the bottom side
            var bottom = image.height * w;
            for (i = image.height; i < h; ++i, bottom += w) {
                for (j = 0; j < image.width; ++j) {
                    array[bottom + j] = array[bottom + j - w];
                }
            }
        }

        if (image.width < w) {
            // Next along the right side
            var right = 0;
            for (i = 0; i < h; ++i, right += w) {
                for (j = image.width; j < w; ++j) {
                    array[right + j] = array[right + j - 1];
                }
            }
        }

        // Put the image back
        context.putImageData(data, 0, 0);

        tex.image = canvas;
        if (tex.flipY) {
            tex.offset.set(0, 1 - image.height / h);
        }
        tex.repeat.set(image.width / w, image.height / h);
    };

    var _this = this;

    // As soon as a tile is loaded, it will be available via getTileShape(tile).
    function requestTile(tile) {
        
        // get tileInfo
        var tileIndex = tile2Index(tile);
        var tileInfo = _tiles[tileIndex];
        
        // if tile is already loading or in memory, do nothing
        if (tileInfo && tileInfo.state !== TileState_Missing) {
            return;            
        }

        // make sure that tileInfo exists
        if (!tileInfo) {
            tileInfo = new TileInfo(_timeStamps.slice());
            _tiles[tileIndex] = tileInfo;
        }

        // mark tile as loading, so that we don't request it again
        tileInfo.state = TileState_Loading;
        
        var path = getTileTextureURL(tile);

        // Callback that updates the tile-shape as soon as the texture is loaded
        var onTexLoaded = function(tex) { // tex = THREE.Texture.

            // drop texture if the iterator has been deleted meanwhile
            if (!_this || !tex) {
                return;
            }

            // when using the iterator for displaying a single image, we get texWidth/texHeihgt/tileSize
            // from the actual image dimensions.
            if (_config.maxLevel === 0) {
                if (_config.texWidth === -1) _config.texWidth  = tex.image.width;
                if (_config.texHeight=== -1) _config.texHeight = tex.image.height;
                if (_config.tileSize === -1) _config.tileSize  = Math.max(tex.image.width, tex.image.height);
                
                // Make tex size available to loadOptions so it's accessible to outside functions.
                if (_config.options) {
                    _config.options.loadOptions.texWidth = _config.texWidth;
                    _config.options.loadOptions.texHeight = _config.texHeight;
                }
                // update bbox - which depends on texture dimensions
                _bbox = config.getBBox();
            }

            // Make the texture a power of 2 so we can use mipmaps
            resizeToPow2(tex);

            // use linear filter, so that we can use non-pow2 textures.
            tex.minFilter = THREE.LinearMipMapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            // Use anisotropic filtering to avoid blurry textures when looking at an angle
            // Cap to 4 to avoid any possible performance issues.
            tex.anisotropy = Math.min(4, Math.max(_config.maxAnisotropy, 1));

            // create material
            const material = createShaderMaterial(LeafletShader);

            material.supportsMrtNormals = true;
            material.supportsViewportBounds = true;
            material.map = material.uniforms.map.value = tex;
            material.side = THREE.DoubleSide;
            material.doNotCut = _this.getDoNotCut();

            material.tile = tile;

            // By default, MaterialManager assigns the environment texture for reflection to all
            // materials that support it. Setting this flag avoids this.
            material.disableEnvMap = true;

            // Activate transparency for PNG images - which might make use of the alpha channel.
            // This is the same heuristic as we apply for F2D/SVF materials (see MaterialManager.addMaterial)
            if (path.toLowerCase().indexOf(".png") !== -1) {
                material.transparent = true;
                material.alphaTest   = 0.01;
            }

            // create tile mesh
            var mesh = createTileShape(tile, material, false);

            // make new tile available
            tileInfo.mesh = mesh;

            // mark tile as loaded, so that we know that its own texture is in memory.
            tileInfo.state = TileState_Loaded;

            // request finished
            _numRequests--;

            // trigger scene update
            _needsRedraw = true;

            // we take care of caching ourselves. To keep consumed memory under control, make sure
            // that no texture is left behind in THREE's internal loader cache
            // Note that we cannot always use 'path' here, because the final image url might differ due
            // to additional credential stuff.
            var texUrl = (tex && tex.image) ? tex.image.src : null;
            if (texUrl && THREE.Cache && THREE.Cache.get(texUrl)) {
                THREE.Cache.remove(texUrl);
            } 

            // trigger custom callback when root is available
            if (tile.level === 0 && _config.onRootLoaded) {
                _modelId = _config.onRootLoaded();
            }

            mesh.themingColor = _themingColor; // By sharing the color object, we can change all the meshes at once.
            mesh.modelId = _modelId; // Update here since the value from createTileShape won't be the correct one

            // Set material name that we use to find and unregister
            // this material in MaterialManager later
            material.name = `model:${_modelId}|${path}`;
            // add material to material manager to make sure that the shader is
            // correctly configured. E.g., to configure in which render targets to write etc.
            _materials.addMaterial(material.name, material, true);

            // Update new material with current state of: viewBounds, visibility, selection.
            _materials.setMaterialViewportBounds(material, _viewBounds);
            _this._updateMaterialVisibility(material);
            _this._updateMaterialSelection(material);
        };

        // track number of open requests
        _numRequests++;

        // load tile texture
        _config.textureLoader(path, function(texture, error) {
            onTexLoaded(texture);
        }, function(err) {
           _config.onDone(err, null);
            console.error(err);
        });
    }

    this.requestRootTile = function() {
        requestTile(new TileCoords(0,0,0));
    };

    // returns a tile shape from memory cache. Returns null if the tile's own
    // texture is not loaded yet.
    function getTileShape(tile) {

        var index    = tile2Index(tile);
        var tileInfo = _tiles[index];

        if (!tileInfo || tileInfo.state !== TileState_Loaded) {
            return null;
        }

        return tileInfo.mesh;
    }

    // tile:   TileCoords
    // outMin: Vector3 (z=0.0)
    function getTileMin(tile, outMin) {
        // Apply scale here and not in getTileMinX/Y because that one's used for the mesh creation as well
        var x = getTileMinX(tile) * _scaleX;
        var y = getTileMinY(tile) * _scaleY;
        outMin.set(x, y, 0);
    }

    function getTileMax(tile, outMax) {
        var scale = getTileScale(tile.level);
        // Apply scale here and not in getTileMinX/Y because that one's used for the mesh creation as well
        var x     = (getTileMinX(tile) + scale) * _scaleX;
        var y     = (getTileMinY(tile) + scale) * _scaleY;
        outMax.set(x, y, 0);
    }

    // Returns true if a tile intersects the view frustum
    var tileInFrustum = (function() {
        var tileMin = new THREE.Vector3();
        var tileMax = new THREE.Vector3();
        var tileBox = new THREE.Box3();

        return function(
            tile,    // {TileCoords}
            frustum  // {FrustumIntersector}
        ) {
            // get tile box
            getTileMin(tile, tileMin);
            getTileMax(tile, tileMax);
           
            tileBox.set(tileMin, tileMax);

            return frustum.intersectsBox(tileBox) > 0;
        };
    }());

    // Computes the priority of a tile based on camera distance and tile size.
    var computeTilePriority = (function() {
        var tileMin = new THREE.Vector3();
        var tileMax = new THREE.Vector3();

        return function(        
            tile,    // {TileCoords}
            frustum, // {FrustumIntersector}
            camPos   // {THREE.Vector3}
        ) {
            // compute xy-distance from camera
            var tileScale  = getTileScale(tile.level);
            getTileMin(tile, tileMin);
            getTileMax(tile, tileMax);
            var dist2      = SceneMath.pointToMinMaxBoxDistance2(camPos, tileMin, tileMax);

            // scale-up priority for visible tiles
            var tileVisible = tileInFrustum(tile, frustum);
            var frustumFactor = (tileVisible ? 100.0 : 1.0);

            // avoid division by zero: for tiles below this distance, 
            // we only distinguish based on tile level
            var MinDist2 = 0.0001;
            dist2 = Math.max(dist2, MinDist2);

            // squared tile size
            var tileScale2 = tileScale * tileScale;

            // Priority = tileSize/dist 
            var priority = (frustumFactor * tileScale2) / dist2;

            return priority;
        };
    }());

    // Estimates for a tile the current screen size in pixels 
    var estimateScreenSize = (function() {
        const tileMin = new THREE.Vector3();
        const tileMax = new THREE.Vector3();

        return function(
            tile,        // {TileCoords}
            camera,      // {UnifiedCamera}
            camDir       // {THREE.Vector3}
        ) {
            getTileMin(tile, tileMin);
            getTileMax(tile, tileMax);
            // Find shortest distance from camera to tile (along the camera direction)
            const dist = Math.abs(projectedBoxDistance(camera.position, camDir, tileMin, tileMax));
            // Find the pixels per unit at that distance (measured in physical device pixels)
            const pixelRatio = _config.getPixelRatio();
            const pixelsPerUnit = camera.pixelsPerUnitAtDistance(dist) * pixelRatio;
            // Calculate the edge length in world units (doesn't matter which since it's a square)
            const edgeLength = tileMax.y - tileMin.y;

            // Return the edge length in pixels
            return edgeLength * pixelsPerUnit;
        };
    }());

    // helper struct used to order tiles based on refinement priority
    function Candidate(tile, prio) {
        this.tile = tile;
        this.prio = prio;
    }

    // compare op to sort candidates by decreasing priority
    function moreImportant(c1, c2) {
        return c1.prio > c2.prio;
    }

    // Updates the timeStamp of the tile to the latest value.
    // If the tile is unknown, it has no effect.
    function updateTimeStamp(tile, viewIndex) {
        var tileInfo = _tiles[tile2Index(tile)];
        if (tileInfo) {
            if (tileInfo.timeStamps[viewIndex] !== _timeStamps[viewIndex]) {
                tileInfo.timeStamps[viewIndex] = _timeStamps[viewIndex];

                // track number of tiles for which we updated the
                _numActiveTiles++;
            }
        }
    }

    // Given a list of required tiles, this method determines the most
    // important ones and triggers as many requests as simultaneously allowed.
    // Returns the number of newly sent requests
    function requestTiles(tiles, frustum, camPos) {

        // sort by decreasing priority
        tiles.sort(function(a, b) {
            var pa = computeTilePriority(a, frustum, camPos);
            var pb = computeTilePriority(b, frustum, camPos);
            return pb - pa;
        });

        // send as many requests as simultaneously allowed
        var newRequests = 0;
        for (var i=0; i<tiles.length; i++) {

            // skip tiles for which there is already a running request
            var tileInfo = getTileInfo(tiles[i]);
            if (tileInfo && tileInfo.state === TileState_Loading) {
                continue;
            }

            // wait for some requests to finish before we request more
            if (_numRequests>=_maxRequests) {
                break;
            }
            
            requestTile(tiles[i]);

            newRequests++;
        }
        return newRequests;
    }

    function disposeMaterial(tileInfo) {
        // nothing to do if there is no material
        if (!tileInfo || !tileInfo.mesh || !tileInfo.mesh.material) {
            return;
        }

        // don't leak material in MaterialManager
        var mat = tileInfo.mesh.material;
        _materials.removeMaterial(mat.name);

        // free GPU resource. We need the memory right now and should
        // not wait for the garbage collector.
        mat.map.dispose();
        mat.map.needsUpdate = true;

        // dispose shader program etc.
        var DISPOSE_EVENT = { type: 'dispose' };
        mat.dispatchEvent(DISPOSE_EVENT);
        mat.needsUpdate = true;
    }

    /** Unregister all material from material texture and disposes textures. 
        Must be called when removing a RenderModel with this iterator.
     */
    this.dispose = function() {
        var i;
        for (i in _tiles) {
            disposeMaterial(_tiles[i]);
        }

        if (_quadGeom) {
            _quadGeom.dispose();
            _quadGeom.needsUpdate = true;
        }

        gm.dispose();
    };

    this.dtor = function() {
        this.dispose();

        // ignore any remaining textureLoad callbacks
        _this      = null;

        // unref MaterialManager right now in case we are the last one holding it.
        _materials = null;
    };

    // check if tile is being used by any active view
    function tileInUse(tileInfo) {
        for (var i=0; i<_timeStamps.length; i++) {
            var viewValid = !!_scenes[i];
            if (viewValid && tileInfo.timeStamps[i] === _timeStamps[i]) {
                return true; 
            }
        }
        return false;
    }

    // Delete tiles cached from previous frames to give space for new ones without
    // exceeding the maximum cache size.
    //
    //  @param {number}             requiredFreeSlots 
    //  @param {FrustumIntersector} frustum
    //  @param {THREE.Vector3}      camPos
    function cacheCleanup(requiredFreeSlots, frustum, camPos) {

        // collect indices of all tiles in memory
        var tileIndices = Object.keys(_tiles);

        // check how many free slots we have already
        var numTilesInMemory = tileIndices.length;
        var availableSlots   = _config.cacheSize - numTilesInMemory;
        var missingSlots     = requiredFreeSlots - availableSlots;

        if (missingSlots <= 0) {
            // No need to delete any tile from cache
            return;
        }

        // sort by increasing timeStamp and tile priority
        tileIndices.sort(function(a, b) {

            // compare based on timeStamps
            // NOTE: LRU caching is currently only applied for the main view.
            //       For other views, we just protect the tiles in use.
            var tsa = _tiles[a].timeStamps[0];
            var tsb = _tiles[b].timeStamps[0];
            if (tsa !== tsb) return tsa-tsb;

            // if timeStamps are equal, use priorites instead
            var tileA = index2Tile(a);
            var tileB = index2Tile(b);
            var prioA = computeTilePriority(tileA, frustum, camPos);
            var prioB = computeTilePriority(tileB, frustum, camPos);
            return prioA-prioB;
        });

        // delete tiles 
        var tilesToDelete = Math.min(missingSlots, tileIndices.length);
        for (var i=0; i<tilesToDelete; i++) {
            var index = tileIndices[i];

            // protect root tile from being deleted
            var tileCoords = index2Tile(index);
            if (tileCoords.level === 0) {
                continue;
            }

            var tileInfo = _tiles[index];

            // Skip any tile that is not in memory. Deleting anything else
            // would not make sense here anyway. But, more important, it is essential never to delete
            // _tiles[] entries for tiles in loading state. Otherwise, the newly arriving textures
            // would get lost.
            if (tileInfo.state !== TileState_Loaded) {
                continue;
            }

            // don't remove tiles that are currently in use. It's better to
            // exceed the cache limit a bit than to permanently delete and load
            // the same tiles.
            if (tileInUse(tileInfo)) {
                break;
            }

            // dispose texture and unregister material from MaterialManager
            // Note that it is important here that each material is unique per tile.
            disposeMaterial(tileInfo);

            delete _tiles[index];
        }
    }

    // Applies the matrix transform to the current scene
    // Returns the camera in case it was modified
    function applyTransformIfNeeded(scene, frustum, camera) {
        const matrixWorld = scene.matrixWorld;
        if (_matrix) {
            // Apply matrix to scene (to place in correct final place). This sets all the transformations
            // to the scene containing the meshes.
            matrixWorld.multiplyMatrices(_matrix, scene.matrix);
        } else {
            matrixWorld.copy(scene.matrix);
        }

        if (!matrixWorld.equals(_identity)) {
            matrixWorld.decompose(_pos, _rotate, _scale);

            _matrixWithoutScale.makeRotationFromQuaternion(_rotate);
            _matrixWithoutScale.setPosition(_pos);

            _scaleX = _scale.x;
            _scaleY = _scale.y;

            // To avoid complicating the tiles priority and size calculation, we assume their position and rotation stay
            // the same, and instead apply the inverse matrix to the camera. Only the scale (_scaleX/Y) will be multiplied
            // to the tile's size.
            //
            // First time _transformedCamera is passed it will create a camera to be reused
            _transformedCamera = camera.clone(_transformedCamera);

            _invMatrixWithoutScale.copy(_matrixWithoutScale).invert();

            _transformedCamera.transformCurrentView(_invMatrixWithoutScale);
            _transformedCamera.updateCameraMatrices();
            
            const cutPlanes = frustum.cutPlanes;
            const areaCullThreshold = frustum.areaCullThreshold;
            frustum = _tmpFrustum;
            frustum.areaCullThreshold = areaCullThreshold;
            frustum.reset(_transformedCamera, cutPlanes);            

            camera = _transformedCamera;
        } else { // Reset the scale
            _scaleX = 1;
            _scaleY = 1;
        }

        return { camera, frustum };
    }

    /** Start iterator 
     *   @param: {FrustumIntersector} frustum  
     *   @param: {UnifiedCamera}      camera
     *   @param: {number}             [viewIndex] - only needed when managing multiple views
     */
    this.reset = function(frustum, camera, viewIndex) {

        viewIndex = viewIndex || 0;

        // Currently we only support additional views for offline rendering parallel to the main view.
        // Therefore:
        //  - We do LRU caching only for main view
        //  - The restriction of max uploads per frame is disabled for offline views
        const isOfflineView = (viewIndex > 0);

        const scene = _scenes[viewIndex];

        ({ camera, frustum } = applyTransformIfNeeded(scene, frustum, camera));
        // Make sure that no mesh objects are leaked in WebGLRenderer. It would be more efficient to do this
        // only once per tile. But since we also create temporary placeholder meshes for tiles displayed at lower
        // resolution, this solution is the simplest and safest. The overhead is not signficiant, because
        // the number of rendered tiles is limited and these events do not dispose geometry or material
        // (which would be expensive)
        var i, tile;
        for (i=0; i<scene.children.length; i++) {
            var obj = scene.children[i];
            obj.dispatchEvent( { type: 'removed' } );
        }

        // clear scene
        scene.children.length = 0;

        // track iterator restarts for LRU cache cleanup
        _timeStamps[viewIndex]++;

        // reset counter of tiles that we mark as "currently used" by updating their timestamp
        _numActiveTiles = 0;

        // reset counter for reused temp geometry.
        gm.reset();

        // scene is empty as long as the root tile is not loaded
        var root = new TileCoords(0,0,0);
        if (!tileLoaded(root)) {
            _done[viewIndex] = true;
            return false;
        }

        // Set of candidates, sorted by decreasing priority.                
        var candidates = new SortedList(moreImportant);

        // start with root tile as only candidate
        var rootTile = new TileCoords(0, 0, 0);
        var prio     = computeTilePriority(rootTile, frustum, camera.position);
        candidates.add(new Candidate(rootTile, prio));

        // normalized view direction
        var camDir = camera.getWorldDirection(new THREE.Vector3());

        // In this loop, we recursively traverse the tile hierarchy to find relevant tiles for the current view.
        // As a result, the three arrays below will be filled.
        // By construction, all arrays will be sorted by decreasing priority.
        var visibleTiles = []; // visible tiles that we will use for rendering
        var culledTiles  = []; // tiles at appropriate resolution, but outside the view frustum (good prefetching candidates)
        var missingTiles = []; // tiles that are not in memory, but required for current view. This includes parents of tiles in use.
        while(candidates.size()>0) {

            // get and remove max-priority candidate
            var candidate = candidates.get(0);
            tile      = candidate.tile;
            candidates.removeAt(0);

            // skip tiles outside the image dimensions
            if (tileOutside(tile)) {
                continue;
            }

            var refine = true;

            // stop if we reached a leaf tile
            if (tile.level === _config.maxLevel) {
                // this is a leaf tile.
                refine = false;
            }

            // if the screen size of the tile is already smaller than its
            // image resolution, there is no point in further refinement.
            const screenSize = estimateScreenSize(tile, camera, camDir);
            if (screenSize < _config.tileSize && _config.isLevelPresent(tile.level)) {
                // tile does not need more refinement
                refine = false;
            }

            // For all tiles in frustum...
            var visible = tileInFrustum(tile, frustum);
            if (visible) {

                // Request tile if missing
                if (!tileLoaded(tile) && _config.isLevelPresent(tile.level)) {
                    missingTiles.push(tile);
                }

                // protect it from removal due to cleanuop
                updateTimeStamp(tile, viewIndex);
            }

            // Block refinement if we collected enough tiles
            if (!visible && visibleTiles.length + culledTiles.length > _config.maxActiveTiles) {
                refine = false;
            }

            // Note that we also refine tiles that are not in memory. This is done to ensure that the
            // traversal is stable: In this way, required tiles always get the latest timeStamp,
            // no matter whether their parents are missing or not.

            // Traverse children or collect the tile
            if (refine) {
                // refine tile into its 4 children
                for (let c=0; c<4; c++) {
                    const child = tile.getChild(c);
                    prio  = computeTilePriority(child, frustum, camera.position);

                    // consider child as new candidate
                    candidates.add(new Candidate(child, prio));
                }
            } else {
                // Collect tile and stop refinement
                if (visible) {
                    visibleTiles.push(tile);
                } else {
                    culledTiles.push(tile);
                }
            }
        }

        // track how many new textures we add in this frame.
        var numNewTextures = 0;

        // any redraws would produce the same result until a new tile arrives.
        _needsRedraw = false;

        // track if all required tiles are available for rendering
        var sceneComplete = true;

        // add tile shapes for all visible tiles to the scene
        for (i=0; i<visibleTiles.length; ++i) {
            tile  = visibleTiles[i];
            var shape = getTileShape(tile);

            if (shape && shape.material.map.needsUpdate && !_aggressivePrefetching) {
                // this shape will trigger a new texture decode/upload in FireFlyRenderer
                if (numNewTextures < _maxTextureUpdatesPerFrame || isOfflineView) {
                    // just track number of new textures
                    numNewTextures++;
                } else {
                    // don't allow more texture upload in this frame.
                    // use a fallback texture instead.
                    shape = createTileShape(tile, null, true);

                    // trigger redraw, so that the remaining texture uploads
                    // are done in subsequent frames.
                    _needsRedraw = true;
                    
                    // don't fire sceneComplete callback yet, before all
                    // required textures are uploaded.
                    sceneComplete = false;
                }
            }

            // Some tiles might not be loaded yet, but already needed in 
            // order to show their loaded siblings at higher resolution.
            if (!shape) {
                // For these tiles, we create a "fallback" tile that
                // is using the material of a lower-resolution parent,
                // but is instantly available. This makes tile loading significantly 
                // faster, because we don't have wait for all siblings of tiles we need.
                shape = createTileShape(tile, null, false);

                sceneComplete = false;
            }
            scene.add(shape);
        }
        
        // return _scene in next nextBatch() call.
        _done[viewIndex] = false;        

        // send requests for missing visible tiles
        var numNewRequests = requestTiles(missingTiles, frustum, camera.position);

        // tiles that are currently being loaded are also considered as being active, because
        // they will soon require some memory as well
        _numActiveTiles += _numRequests;

        // Process some tiles outside the frustum for prefetching (if our budget allows it)
        var prefetchRequests = [];
        for (i=0; i<culledTiles.length; i++) {

            // stop if our active tile limit is reached
            if (_numActiveTiles >= _config.maxActiveTiles) {
                break;
            }

            tile = culledTiles[i];

            if (!tileLoaded(tile)) {
                // tile is not in memory yet => consider for request
                prefetchRequests.push(tile);
                _numActiveTiles++;
            } else {
                // tile is already in memory. Just set its timestamp to keep it in memory
                // mark this tile and its parents as active if our budget allows it.
                for (let level=0; level<=tile.level; level++) {
                    // mark parent as active
                    const parent = tile.getParentAtLevel(level);
                    updateTimeStamp(parent, viewIndex);

                    // stop if we reached the limit
                    if (_numActiveTiles > _config.maxActiveTiles) {
                        break;
                    }
                }
            }
        }
        // add some more requests for prefetching of tiles close to the view frustum
        numNewRequests += requestTiles(prefetchRequests, frustum, camera.position);

        if (_aggressivePrefetching) {
            // Get some of the children for faster zooming
            prefetchRequests = [];
            for (i = 0; i < visibleTiles.length; ++i) {

                tile = visibleTiles[i];
                if (tile.level === _config.maxLevel || !_config.isLevelPresent(tile.level + 1)) {
                    continue;
                }

                for (let c = 0; c < 4; c++) {
                    const child = tile.getChild(c);
                    if (tileOutside(child) || !tileInFrustum(child, frustum)) {
                        continue;
                    }

                    if (!tileLoaded(child)) {
                        // tile is not in memory yet => consider for request
                        prefetchRequests.push(child);
                        _numActiveTiles++;
                    }
                }
            }

            numNewRequests += requestTiles(prefetchRequests, frustum, camera.position);
        }

        // Note: LRU caching is currently only done for the main view. For any other views
        //       we only protect active tiles from being deleted.
        if (!isOfflineView) {
            // clear tiles from LRU cache if needed
            // Note that we must not dispose any material that is used in this
            // frame. This is ensured, because we never delete tiles with
            // the current frame timestamp.
            cacheCleanup(numNewRequests, frustum, camera.position);
        }

        // trigger callback if
        if (sceneComplete && _onRefinedCallbacks.length > 0) {
            // Note: At this point, we are usually in the middle of a rendering cycle. Although the scene is now
            // fully refined, it is not visible on screen yet. Therefore, we defer the event so that the
            // current animation cycle can be finished first.
            var callbacks = _onRefinedCallbacks.splice(0, _onRefinedCallbacks.length);
            setTimeout(function(){
                for (var i=0; i<callbacks.length; i++) {
                    callbacks[i](viewIndex);
                }
            }, 1);
        }

        return sceneComplete;
    };

    /** @param {function} cb - A callback without params or return value. Called once as soon as all textures have
     *                         been refined to the required resolution for the current view. */
    this.callWhenRefined = function(cb) {
        _onRefinedCallbacks.push(cb);
    };

    /** @returns {bool} Indicates that a full redraw is required to see the latest state. */
    this.update = function() {
        return _needsRedraw;
    };

    /**
     * @param {number} newScale 
     */
    this.setDpiScale = function(newScale) {
        _dpiScale = newScale;
    };

    /**
     * @returns {number}
     */
    this.getDpiScale = function() {
        return _dpiScale;
    };

    this.setThemingColor = function(c) {
        _themingColor.copy(c);
    }

    this.clearThemingColor = function() {
        _themingColor.copy(_defaultTheming);
    }

    this.unregisterView = function(viewIndex) {
        _scenes[viewIndex] = undefined;
        _timeStamps[viewIndex] = undefined;
        _done[viewIndex] = undefined;

        // remove unused array entries
        var newLength = _scenes.length;
        while(newLength > 0 && !_scenes[newLength-1]) newLength--;
        _scenes.length = newLength;
        _timeStamps.length = newLength;
        _done.length = newLength;
    };

    this._updateMaterialVisibility = function (material) {
        if (!material.defines["GHOSTED"] ^ !_isGhosted) {

            if (!_isGhosted) {
                delete material.defines["GHOSTED"];
            } else {
                material.defines["GHOSTED"] = 1;
            }

            material.needsUpdate = true;
        }
    };

    this.setVisibility = function (visible) {
        _isGhosted = !visible;

        _materials.forEachInModel(_modelId, false, material => {
            this._updateMaterialVisibility(material);
        });
    };

    this._updateMaterialSelection = function (material) {
        material.uniforms["selectionColor"].value.set(_selectionColor.r, _selectionColor.g, _selectionColor.b, _isSelected ? _SelectionColorAlpha : 0);
    };

    this.highlightSelection = function (selected, color = _selectionColor) {
        _isSelected = selected;
        _selectionColor = color;

        _materials.forEachInModel(_modelId, false, material => {
            this._updateMaterialSelection(material);
        });
    };
}
