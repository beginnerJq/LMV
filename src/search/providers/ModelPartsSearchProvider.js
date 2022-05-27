import SearchProviderInterface from './SearchProviderInterface';

export default class ModelPartsSearchProvider extends SearchProviderInterface {
    constructor(viewer) {
        super(viewer);
    }

    /**
     * Function returns result that contains filtered by search query list of dbIds
     * @param {string} searchQuery - search query for model browser
     * @returns {Promise} Promise with array of dbIds for each model.
     */
    search(searchQuery) {
        return new Promise((resolve, reject) => {
            const models = this.viewer.getVisibleModels();
            const result = [];

            if (models.length===0)
                resolve(result);

            for (let i = 0;i < models.length;i++) {
                const model = models[i];
                const ids = [];
                const tree = model.getInstanceTree();

                model.getObjectTree(obj =>{
                    obj.enumNodeChildren(obj.getRootId(), dbId => {
                        const idName = tree && tree.getNodeName(dbId);
                        if (idName && idName.toLowerCase().indexOf(searchQuery) !== -1) {
                            ids.push(dbId);
                        }
                    }, true);
                });
                result.push({ids, model});
            }
            resolve(result);
        });
    }

    /**
     * @returns {string} Name of Search Provider
     */
    getProviderId() {
        return 'ModelPartsSearchProvider';
    }
}
