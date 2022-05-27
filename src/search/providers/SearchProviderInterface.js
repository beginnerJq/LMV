export default class SearchProviderInterface {
    constructor(viewer) {
        this.viewer = viewer;
    }

    /**
     * Performs search in search providers
     * @param {string} userInput - search query input from user
     * @returns {Promise} Promise with array of dbIds for each model.
     */
    search(userInput) {
        return new Promise((resolve, reject) => {
        });
    }

    /**
     * @returns {string} Name of Search Provider
     */
    getProviderId() {
        return 'Search Provider Id';
    }
}
