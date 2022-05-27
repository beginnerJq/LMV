
import i18n from "i18next";
import { GlobalManagerMixin } from '../application/GlobalManagerMixin';

// Output similar to: https://jsfiddle.net/mmsgxwvf/1/
export function LoadingSpinner(parentDiv) {

    this.parentDiv = parentDiv;
    var _document = this.getDocument();
    this.container = _document.createElement('div');
    this.container.innerHTML = [
        '<div class="path">',
          '<svg width="100%" height="100%" viewBox="0 0 100 100" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
            '<path d="M2.5,50a47.5,47.5 0 1,0 95,0a47.5,47.5 0 1,0 -95,0" vector-effect="non-scaling-stroke"/>',
            '<path d="M 2.5 50 A 47.5 47.5 0 0 1 47.5 2.5" vector-effect="non-scaling-stroke"/>',
          '</svg>',
        '</div>',
        '<div class="message" data-i18n="Spinner Loading">LOADING</div>'
    ].join('');
    this.container.className = 'loading-spinner';
}

GlobalManagerMixin.call(LoadingSpinner.prototype);

LoadingSpinner.prototype.addClass = function(className) {
    this.container.classList.add(className);
};

LoadingSpinner.prototype.attachToDom = function() {
    if (!this.container.parentNode) {
        i18n.localize(this.container);
        this.parentDiv.appendChild(this.container);
        return true;
    }
    return false;
};

LoadingSpinner.prototype.removeFromDom = function() {
    if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
        return true;
    }
    return false;
};

LoadingSpinner.prototype.setVisible = function(visible) {
    if (visible) {
        this.attachToDom();
    }     
    else {
        this.removeFromDom();
    }  
};


