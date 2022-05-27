import { logger } from '../logger/Logger';
import { AnalyticsProviderInterface } from './interface';

class ViewerAnalytics {
  constructor() {
    // map of providerName : class, for e.g., 'mixpanel' : Mixpanel
    this.providerMap = {};
    this.instances = [];
    this.superProps = {}; // properties that are sent with every track request
    this.shouldTrack = true;

    this.trackCache = []; // to store track calls until the first instance is created
    this.oneTimers = {}; // Events that should get tracked only once per viewer session.
  }

  /**
   * Register an analytics provider class
   * @param {object} PClass - Provider class of type AnalyticsProviderInterface
   */
  registerProvider(PClass) {
    if (!PClass) {
      logger.error('Undefined provider');
      return;
    }
    if (!PClass.name) {
      logger.error('missing provider name');
      return;
    }
    const n = PClass.name.toLowerCase();
    if (n in this.providerMap) {
      logger.warn(`Provider with name ${PClass.name} already registered`);
    } else {
      this.providerMap[n] = PClass;
    }

    // create and initialize default instance
    const defaultInstance = this.createInstance(PClass.name, PClass.defaultOptions);
    this.instances.push(defaultInstance);
    if (this.shouldTrack) {
      this.init(defaultInstance);
    }

    // track data cached before the first instance was created
    if (this.trackCache.length > 0) {
      this.trackCache.forEach(({ event, properties }) => {
        this.track(event, properties);
      });
      this.trackCache = []; // clear
    }
  }

  init(providerInstance) {
    if (!providerInstance.initialized) {
      providerInstance.init();
      providerInstance.register(this.superProps);
    }
  }

  createInstance(providerName, options) {
    const pname = providerName && providerName.toLowerCase();
    if (!(pname in this.providerMap)) {
      logger.error(`Unknown ${providerName}`);
      return;
    }

    const PClass = this.providerMap[pname];
    const instance = new PClass(options);
    if (!(instance instanceof AnalyticsProviderInterface)) {
      throw new Error('not an analytics provider');
    }

    // instance name
    PClass.instanceCount = PClass.instanceCount || 0;
    instance.name = `${pname}-${PClass.instanceCount}`; // for e.g., mixpanel-0
    PClass.instanceCount++;
    return instance;
  }

  optIn(options) {
    this.instances.forEach(i => this.init(i));
    this._callMethod('optIn', options);
    this.shouldTrack = true;
  }

  optOut(options) {
    this._callMethod('optOut', options);
    this.shouldTrack = false;
  }

  hasOptedOut() {
    return this._callMethod('hasOptedOut');
  }

  getDistinctId() {
    return this._callMethod('getDistinctId');
  }

  track(event, properties, isOneTimer) {
    if (!this.shouldTrack) {
      return;
    }
    
    // In case this event is a one-timer, make sure to track it only once per viewer session.
    if (isOneTimer) {
        const eventWithProps = { event, properties };

        try {
            const key = JSON.stringify(eventWithProps);

            // Event was already tracked before - skip it.
            if (this.oneTimers[key]) {
                return;
            }

            this.oneTimers[key] = true;   
        } catch (_) {
            // Unable to stringify event (probably because of a circular dependency - shouldn't happen anyway).
            // Don't crash because of it - just ignore isOneTimer flag for this one.
        }
    }    
    
    if (this.instances.length === 0) {
      this.trackCache.push({ event, properties });
    } else {
      this._callMethod('track', event, properties);
    }
  }

  identify(distinctId) {
    this._callMethod('identify', distinctId);
  }

  _callMethod(...args) {
    const methodName = args[0];
    const rest = args.slice(1, args.length);
    return this.instances.map(inst => ({
      name: inst.name,
      value: inst[methodName](...rest)
    }));
  }
}

const instance = new ViewerAnalytics();
export { instance as analytics };
