import ModelPartsSearchProvider from './providers/ModelPartsSearchProvider';
import PropertiesSearchProvider from './providers/PropertiesSearchProvider';
import TextSearchProvider from './providers/TextSearchProvider';

export class SearchManager{
    constructor(viewer) {
        this.viewer = viewer;
        this.searchProviders = new Map();
    }

    /**
     * Add Search Provider Class to list of providers within SearchManager 
     * @param {SearchProvider} searchProvider 
     */
    addSearchProvider(SearchProvider) {
        if (!this.searchProviders.has(SearchProvider)) {
            this.searchProviders.set(
                SearchProvider, new SearchProvider(this.viewer)
            );
        }
    }

    /**
     * Performs search in search providers
     * @param {string} userInput - search query input from user.
     * @returns {Promise} Function returns a Promise with array of results from providers.
     */
    search(userInput) {
        return new Promise((resolve, reject) => {
            const searchQuery = this.prepareSearchInput(userInput);
            const promises = [];

            this.searchProviders.forEach(searchProvider => { 
                const promise = searchProvider.search(searchQuery);
                const searchProviderId = searchProvider.getProviderId();
                promise.id = searchProviderId;
                promises.push(promise);
            });

            Promise.all(promises).then(results => {
                const res = {};

                results.forEach((result, index) => {
                    const currentId = promises[index].id;
                    res[currentId] = result;
                });
                resolve(res);
            })
            .catch(reject);

        });
    }
    
    /**
     * Remove search providers
     */
    removeAllProviders() {
        this.searchProviders.clear();
    }
    
    /**
     * Remove specific search provider
     */
    removeProvider(SearchProvider) {
        this.searchProviders.delete(SearchProvider);
    }

    /**
     * Basic string handling.
     * @param {string} searchQuery - search query input
     */
    prepareSearchInput(searchQuery) {
        return searchQuery.toLowerCase();
    }
}

const namespace = AutodeskNamespace('Autodesk.Viewing.Search');
namespace.SearchManager = SearchManager;
namespace.ModelPartsSearchProvider = ModelPartsSearchProvider;
namespace.PropertiesSearchProvider = PropertiesSearchProvider;
namespace.TextSearchProvider = TextSearchProvider;
