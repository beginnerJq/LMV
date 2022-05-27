export class AnalyticsProviderInterface {
	constructor(options = {}) {
		this.options = options;
	}
	/**
	 * Called by ViewerAnalytics to initialize the provider library
	 */
	init() {}

	/**
	 * Called after init. This could be used to register super properties
	 */
	register() {} 
	static get name() { return null; } // to be overridden
	static get defaultOptions() { return {}; } // to be overridden
	optIn(options) {}
	optOut(options) {}
	hasOptedOut() {}
	getDistinctId() {}
	track(event, properties) {}
	identify(distinctId) {}
}
