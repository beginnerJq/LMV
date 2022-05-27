import SearchProviderInterface from './SearchProviderInterface';

export default class PropertiesSearchProvider extends SearchProviderInterface {
    constructor(viewer) {
        super(viewer);
    }

    /**
     * Async function that returns a list of properties by searchQuery
     * @param {string} searchQuery - search query for model properties
     * @returns {Promise} Promise with array of dbIds for each model.
     */
    search(searchQuery) {
        return new Promise((resolve, reject) => {
            const models = this.viewer.getVisibleModels();
            const result = [];
            
            if (models.length === 0)
                resolve(result);
            
            for (let i = 0; i < models.length; i++) {
                const model  = models[i];
                model.search(searchQuery,
                    // onLoadCallback
                    ids => {
                        result.push({ ids, model });
                        if (result.length === models.length)
                            resolve(result);
                    },
                    // onErrorCallback
                    reject
                );   
            }
        });
    }

    /**
     * @returns {string} Name of Search Provider
     */
    getProviderId() {
        return 'PropertiesSearchProvider';
    }
}
