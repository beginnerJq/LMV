import SearchProviderInterface from "./SearchProviderInterface";

export default class TextSearchProvider extends SearchProviderInterface {
    constructor(viewer) {
        super(viewer);
        viewer.loadExtension('Autodesk.StringExtractor');
    }

    /**
     * Function returns result that contains filtered by search query list of strings
     * @param {string} searchQuery - search query for String search
     * @returns {Promise} Promise with array of strings for each model.
     */
    search(searchQuery) {
        return new Promise ((resolve) => {
            this.viewer.getExtensionAsync('Autodesk.StringExtractor').then((ext) => {
                return ext.getDocumentStrings().then((documentStrings) => {
                    const result = [];
    
                    // Perform search only on visible 2D models
                    const models = this.viewer.impl.get2DModels();
                    for (let i = 0; i < models.length; i++) {
                        const modelId = models[i].id;

                        // Partial (sub-string) search available for non-leaflet documents only
                        const partialSearch = !models[i].isLeaflet();
                        const extractedData = documentStrings[modelId];

                        if (!extractedData) {
                            continue;
                        }
                        
                        const extractedStrings = extractedData.strings;
                        const searchResult = this.searchStrings(extractedStrings, searchQuery, modelId, partialSearch);
                        result.push({ modelId, searchResult });
                    }
                    resolve(result);
                });
            });
        });
    }

    /**
     * Functions performs search on a given data by filtering with searchQuery
     * @param {Array} data data to search in
     * @param {string} searchQuery filtering string from user's input
     * @param {int} modelId Id of current model if viewer contains several
     * @param {boolean} partialSearch if true, sub-string search executed
     * @returns {Array} Array with search result objects which include string and bounding boxes.
     */
    searchStrings(data, searchQuery, modelId, partialSearch) {
        let searchResult = [];

        // Build bounding box according to Character width for F2D and PDF.js files
        // Otherwise build bounding box for the whole sting as for Leaflet cases
        if (partialSearch) {
            for (let i = 0; i < data.length; i++) {
                let idx = 0;
                const occurrences = [];
    
                // Check all occurrences of search query in a given string. idx of match saved to data object.
                while (idx !== -1) {
                    idx = data[i].string.toLowerCase().indexOf(searchQuery, idx);
                    if (idx !== -1) {
                        occurrences.push(idx);
                        idx+=1;
                    }
                }
                if (occurrences.length > 0) {
                    const tempResults = this.splitOccurrences(data[i], occurrences, searchQuery, modelId);
                    searchResult = searchResult.concat(tempResults);
                }
            }
        } else {
            for (let i = 0; i < data.length; i++) {
                if (data[i].string.toLowerCase().indexOf(searchQuery) !== -1) {
                    searchResult.push(data[i]);
                }
            }
        }
        return searchResult;
    }

    /**
     * Function splits matches into separate bounding boxes with angles for highlight
     * @param {Object} stringObject - string objects which contain properties as height/width/charWidth
     * @param {Array} occurrences - array which contains set of positions of matches for a given search query in array
     * @param {string} searchQuery - string which will be wrapped into bounding box
     * @param {string} modelId - modelId to match correct results for model in case multiple models exist
     * @returns {Array} results - search matches with corresponding bounding boxes
     */
    splitOccurrences(stringObject, occurrences, searchQuery, modelId) {
        const model = this.viewer.impl.findModel(modelId);
        const results = [];
        let dpi = 1 / 72;
        const modelData = model.getData();

        //Function calculates width of a given string according to char width
        function calculateWidth(start, end) {
            const croppedWidth = stringObject.stringCharWidths.slice(start, end);
            if (!croppedWidth.length) {
                return 0;
            }
            
            const totalWidth = croppedWidth.reduce((allWidths, currentWidth) => allWidths + currentWidth);
            return totalWidth;
        }
        
        if (model) {
                const targetUnits = modelData.metadata.page_dimensions.page_units;
                const toTargetUnits = Autodesk.Viewing.Private.convertUnits(Autodesk.Viewing.Private.ModelUnits.INCH, targetUnits, 1, 1);
                dpi *= toTargetUnits;
                // Get scale of document if available
                const docScaleX = modelData.scaleX;
                const docScaleY = model.getData().scaleY || dpi; // PDFs don't have scaleY property. Need to calculate manually according to DPI.
                
                // Scale string height to fit canvas units
                const scaledStringHeight = docScaleY * stringObject.stringHeight;
                
                // Create bounding boxes for every search result and store it with angles for rotation.
                for (let i = 0; i < occurrences.length; i++) {
                    const searchMatch = { string: searchQuery };

                    // Offset for a bounding box of a string if search result starts from n-th character of the string.
                    let bboxWidthOffset = calculateWidth(0, occurrences[i]);
                    let bboxWidth = calculateWidth(occurrences[i], occurrences[i] + searchQuery.length);

                    // Calculate a ratio of stringWidth to sum of characters' width in order to get correct units for canvas.
                    // data.stringWidth doesn't exist for F2D documents, in this case just scale according to document parameters.
                    if (stringObject.stringWidth) {
                        const sumWidth = calculateWidth(0, stringObject.string.length);
                        const widthRatio = stringObject.stringWidth / sumWidth * dpi;
                        bboxWidthOffset = bboxWidthOffset * widthRatio;
                        bboxWidth = bboxWidth * widthRatio;
                    } else {
                        bboxWidthOffset =  bboxWidthOffset * docScaleX;
                        bboxWidth = bboxWidth * docScaleX;
                    }

                    // Angle offset used for cases whenever search result starts from n-th character of the string
                    const angle = stringObject.angle || 0;
                    const angleOffsetX = Math.cos(angle) * bboxWidthOffset;
                    const angleOffsetY = Math.sin(angle) * bboxWidthOffset;

                    //Set position of a bounding box of search result
                    let minX = stringObject.stringPosition[0] + angleOffsetX;
                    let minY = stringObject.stringPosition[1] + angleOffsetY;
                    let maxX = minX + bboxWidth;
                    let maxY = minY + scaledStringHeight;

                    // Create bounding box and save angle for rotation by pivot point
                    const min = new THREE.Vector2(minX, minY);
                    const max = new THREE.Vector2(maxX, maxY);
                    const bBox = new THREE.Box2(min, max);
                    searchMatch.boundingBox = bBox;
                    searchMatch.angle = stringObject.angle;
                    results.push(searchMatch);
            }
        }
        return results;
    }

    /**
     * @returns {string} Name of Search Provider
     */
    getProviderId() {
        return 'TextSearchProvider';
    }
}
