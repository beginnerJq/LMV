import * as globals from "../globals.js";
import { isNodeJS } from  "../../compat";
import * as THREE from "three";
import { logger } from "../../logger/Logger";

//Finds a precanned BufferAttribute corresponding to the given
//attribute data, so that we don't have to allocate the same exact
//one over and over and over.
    var bufattrs = {};

    export function findBufferAttribute(attributeName, attributeData, numInstances, interleavedBuffers) {

        //Note .array could be undefined in case we are using
        //an interleaved buffer.
        var attr;
        var attrNormalized = attributeData.normalize || attributeData.normalized;
        if (!attributeData.isInterleavedBufferAttribute && attributeData.array) {
            attr = new THREE.BufferAttribute(attributeData.array, attributeData.itemSize);
        }
        else {
                                           
            var id = attributeName + "|" +
                attributeData.bytesPerItem + "|" +
                attrNormalized + "|" +
                attributeData.isPattern + "|" +
                attributeData.divisor + "|" +
                attributeData.offset;

            attr = bufattrs[id];
            if (attr)
                return attr;

            attr = new THREE.BufferAttribute(undefined, attributeData.itemSize);
            bufattrs[id] = attr;

                     
                                                   
                                                                                       
                                                                                  
                                                                                                
                                                          
                                                                                       
                                                                                  
                                                                                                
                    
                                                                                  
                                                                                  
             
                      
        }

        attr.normalized = attrNormalized;

        // TODO: Below are custom properties of LMV. Some of them are not required in the tug build.
        // For example, itemOffset is the same as offset, which is already part of interleaved attributes in tug.
        // We only set it again for backward compatibility. This should be cleaned up while properly porting to the new
        // BufferGeometry / (Interleaved)BufferAttribute APIs.
        attr.bytesPerItem = attributeData.bytesPerItem;
        attr.isPattern = attributeData.isPattern;

        if (numInstances) {
            attr.divisor = attributeData.divisor;
        }

        if (!attributeData.isInterleavedBufferAttribute && attributeData.array) {
            //Is the data for the attribute specified separately
            //from the interleaved VB?
        }
        else if (attributeData.hasOwnProperty("offset")) {
            //If the attribute is in the interleaved VB, it has
            //an offset into it.
            attr.itemOffset = attributeData.isInterleavedBufferAttribute ?
                attributeData.itemOffset : attributeData.offset;
        }
        else {
            logger.warn("VB attribute is neither interleaved nor separate. Something is wrong with the buffer specificaiton.");
        }

        return attr;
    }

    var attrKeys = {};

    function findAttributesKeys(geometry) {
        var key = "";

        for (var p in geometry.attributes)
            key += p + "|";

        var res = attrKeys[key];
        if (res)
            return res;

        res = Object.keys(geometry.attributes);
        attrKeys[key] = res;

        return res;
    }
    
                                   
                                                    
                                                                       
                                    
                                                          
                                                                                                        
                                                          
                                                                                                             
                                                                                   
                                  
     
              

    var indexAttr16;
    var indexAttr32;
    var LeanBufferGeometry;
    var idcounter = 1;

    function initBufferGeometry() {

        indexAttr16 = new THREE.BufferAttribute(undefined, 1);
        indexAttr16.bytesPerItem = 2;

        indexAttr32 = new THREE.BufferAttribute(undefined, 1);
        indexAttr32.bytesPerItem = 4;

        LeanBufferGeometry = function () {

            //Avoid calling the superclass constructor for performance reasons.
            //Skips the creation of a uuid and defining an accessor for the .id property.
            //THREE.BufferGeometry.call(this);

            this.id = idcounter++;

            this.attributes = {};

            // Note:
            //  1. Although __webglInit would also be undefined without this assignment, it is still essential
            //     for performance reasons, because it makes this property known to the JIT compiler. Otherwise,
            //     it would be attached to each buffer later in WebGLRenderer - which would waste performance.
            //  2. It is essential to use "undefined" and not "false" here. The reason is that WebGLRenderer
            //     only checks in the form "__webglInit === undefined", i.e., setting it to "false" here would have
            //     the same effect like setting it to "true" and would finally cause a memory leak.
            this.__webglInit = undefined;

                                           
             
                                                                                                                     
                                                                                                                       
                                                                                                     
                                          
                                                               
             
                      
        };

        LeanBufferGeometry.prototype = Object.create(THREE.BufferGeometry.prototype);
        LeanBufferGeometry.prototype.constructor = LeanBufferGeometry;
    }

                                   
                                                                                                                
                                                              
                                                                                                             
                                                                                                                    
                                                           
                           
                             
                                                                     

                                           
                                                     

                         
     

                                                                                       
                                                                        
              

    export function createBufferGeometry() {
        if (!indexAttr16)
            initBufferGeometry();

            return new LeanBufferGeometry();
    }

    //Converts a mesh description passed back from worker threads into a renderable three.js
    //compatible BufferGeometry.
    //Sets various extra flags we need.
    export function meshToGeometry(mdata) {

        var mesh = mdata.mesh;
        var geometry = createBufferGeometry();

        if (isNodeJS()) {
            //Used by SVF post-processing tools
            geometry.packId = mdata.packId;
            geometry.meshIndex = mdata.meshIndex;
        }

        geometry.byteSize = 0;

        geometry.vb = mesh.vb;
        geometry.vbstride = mesh.vbstride;

        let interleavedBuffers;
                                       
                                                                
                  

        geometry.vbbuffer = undefined;
        geometry.vbNeedsUpdate = true;
        geometry.byteSize += mesh.vb.byteLength;
        geometry.hash = mdata.hash;

        if (mesh.isLines) /* mesh is SVF lines */
            geometry.isLines = mesh.isLines;
        if (mesh.isWideLines) {/* mesh is SVF wide lines */
            geometry.isWideLines = true;
            geometry.lineWidth = mesh.lineWidth;
        }
        if (mesh.isPoints) { /* mesh is SVF points */
            geometry.isPoints = mesh.isPoints;
            geometry.pointSize = mesh.pointSize;
        }
        if (mdata.is2d) /* mesh is from F2D */ {
            geometry.is2d = true;
        }

        geometry.numInstances = mesh.numInstances;

        for (var attributeName in mesh.vblayout) {
            var attributeData = mesh.vblayout[attributeName];
            
            geometry.attributes[attributeName] = findBufferAttribute(attributeName, attributeData, geometry.numInstances, interleavedBuffers);
        }
        //Index buffer setup
        if (!globals.memoryOptimizedLoading) {
            var iAttr = new THREE.BufferAttribute(mesh.indices, 1);
            iAttr.bytesPerItem = (mesh.indices instanceof Uint32Array) ? 4 : 2;
            geometry.setIndex(iAttr);
        } else {
                                           
            {
                geometry.index = (mesh.indices instanceof Uint32Array) ? indexAttr32 : indexAttr16;
            }
                     
             
                                                                            
                                                                                            
             
                      

            geometry.ib = mesh.indices;
            geometry.ibbuffer = undefined;

            if (mesh.iblines) {
                                               
                {
                    geometry.attributes.indexlines = (mesh.iblines instanceof Uint32Array) ? indexAttr32 : indexAttr16;
                }
                          
                 
                                                                                   
                                                                                                   
                 
                          
                geometry.iblines = mesh.iblines;
                geometry.iblinesbuffer = undefined;
            }
        }

        geometry.attributesKeys = findAttributesKeys(geometry);

        geometry.byteSize += mesh.indices.byteLength;

        //TODO: Not sure chunking into list of smaller offset/counts
        //is required for LMV data since it's already broken up.
        //if (mesh.indices.length > 65535)
        // Works fine now. Left in for debugging.
        //if (mesh.vb.length / mesh.vbstride > 65535)
        //    logger.warn("Mesh with " + (mesh.vb.length / mesh.vbstride) + " > 65535 vertices. It will fail to draw.");

        //TODO: This is a transient object that gets freed once the geometry
        //is added to the GeometryList. We can save on the object creation
        //eventually when we do micro optimizations.
        geometry.boundingBox = new THREE.Box3().copy(mesh.boundingBox);
        geometry.boundingSphere = new THREE.Sphere().copy(mesh.boundingSphere);

        mdata.geometry = geometry;

        mdata.mesh = null;
    }

export let BufferGeometryUtils =  {
    meshToGeometry: meshToGeometry,
    createBufferGeometry: createBufferGeometry,
    findBufferAttribute: findBufferAttribute
};
