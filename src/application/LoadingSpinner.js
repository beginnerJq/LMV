import { GlobalManagerMixin } from './GlobalManagerMixin';

export class LoadingSpinner {

    constructor(){
        this.domElement = null;
    }

    createDom(container) {
        var _document = this.getDocument();
        var loadSpinner = _document.createElement("div");
        loadSpinner.className = "spinner";
        container && container.appendChild(loadSpinner);

        // Generate circles for spinner
        for (var i=1; i<=3; i++) {
            var spinnerContainer = _document.createElement("div");
            spinnerContainer.className = "bounce" + i;
            //spinnerContainer.style['background-color'] = 'red';
            loadSpinner.appendChild(spinnerContainer);
        }

        this.domElement = loadSpinner;
        this.hide();
        return loadSpinner;
    }

    show() {
        if (this.domElement) {
            this.domElement.style.display = "block";
        }
    }

    hide() {
        if (this.domElement) {
            this.domElement.style.display = "None";
        }
    }

    destroy() {
        this.domElement = null;
    }
}

GlobalManagerMixin.call(LoadingSpinner.prototype);