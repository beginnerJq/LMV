
import { SceneMath } from "../wgs/scene/SceneMath";

/**
 * Used in order to convert from Leaflet coordinates to PDF coordinates.
 */
function leafletToPdfWorld(viewer, point) {
    const leafletNormalizingMatrix = getLeafletNormalizingMatrix(viewer);
    
    if (!leafletNormalizingMatrix) {
      return null;
    }

    point.applyMatrix4(leafletNormalizingMatrix);

    let pdfNormalizingMatrix;

    // In case the model is Leaflet, generate bbox from the metadata.
    if (viewer.model.isLeaflet()) {
      const dimensions = viewer.model.getMetadata('page_dimensions');
      const bbox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(dimensions.page_width, dimensions.page_height, 0));
      pdfNormalizingMatrix = SceneMath.getNormalizingMatrix(undefined, bbox);
    } else {
      // Otherwise it's a vector-PDF - just take the bounding box from the model itself.
      pdfNormalizingMatrix = SceneMath.getNormalizingMatrix(viewer.model);
    }

    point.applyMatrix4(pdfNormalizingMatrix.invert());

    return point;
}

/**
 * Used in order to convert from PDF coordinates to Leaflet coordinates.
 * 
 * Assumes the current model is loaded with PDFLoader.
 */
function pdfToLeafletWorld(viewer, point) {
    const pdfNormalizingMatrix = SceneMath.getNormalizingMatrix(viewer.model);
    point.applyMatrix4(pdfNormalizingMatrix);

    let leafletNormalizingMatrix = getLeafletNormalizingMatrix(viewer);
  
    if (!leafletNormalizingMatrix) {
      return null;
    }

    point.applyMatrix4(leafletNormalizingMatrix.invert());

    return point;
}

/**
 * Searches inside the bubble for the Leaflets params.
 */
function getLeafletLoadOptions(viewer) {
  const documentNode = viewer.impl.model.getDocumentNode();

  const leafletItem = documentNode?.search(Autodesk.Viewing.BubbleNode.LEAFLET_NODE)[0]?._raw();
  
  if (!leafletItem) {
    return null;
  }

  const options = {};
  const _document = new Autodesk.Viewing.Document(documentNode.getRootNode()._raw(), '');
  _document.getLeafletParams(options, documentNode, leafletItem);

  return options;
}

/**
 * Calculates the Leaflet's bounding box, using parameters from the bubble.
 * Use the same original logic from the leaflet loader.
 */
function getLeafletBoundingBox(viewer) {
  const texQuadConfig = new Autodesk.Viewing.Private.TexQuadConfig();
  const options = getLeafletLoadOptions(viewer);

  if (!options) {
    return null;
  }

  texQuadConfig.initFromLoadOptions(null, options);
  const boundingBox = texQuadConfig.getBBox();

  return boundingBox;
}

function getLeafletNormalizingMatrix(viewer) {
  const bbox = getLeafletBoundingBox(viewer);

  if (!bbox) {
    return null;
  }

  const matrix = SceneMath.getNormalizingMatrix(null, bbox);

  return matrix;
}


export var PDFUtils = {
    leafletToPdfWorld,
    pdfToLeafletWorld,
    getLeafletLoadOptions,
    getLeafletBoundingBox,
    getLeafletNormalizingMatrix
};
