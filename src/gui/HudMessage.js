
import i18n from "i18next";


/** @constructor */
export function HudMessage() {
}

HudMessage.instances = [];

// static
HudMessage.displayMessage = function(container, messageSpecs, closeCB, buttonCB, checkboxCB ) {

    
    let _document = container.ownerDocument;
    let _window = _document.defaultView || _document.parentWindow;

    function getClientHeight(element) {
        var style = _window.getComputedStyle(element); 

        var margin = {
            top: parseInt(style["margin-top"]),
            bottom: parseInt(style["margin-bottom"])
        };

        var rect = element.getBoundingClientRect();
        return rect.height + margin.top + margin.bottom;
    }

     /**
     * Get the styles of the specified html element.
     * @param {HTMLElement} element - html element that is used to get the specified styles
     * @param {String[]|String} stylesToGet - An array of style names
     * @param {Object} assignToObject - (Optional) if passed in, the element's styles are coppied to this object
     * @returns {Object|String} - returns an object if stylesToGet is an array, otherwise returns a string
     */
    function getElementStyles(element, stylesToGet, assignToObject) {
        var eleStyle = _window.getComputedStyle(element, null);
        if (!(Array.isArray(stylesToGet)))
            return eleStyle[stylesToGet];

        var styles = assignToObject ? assignToObject : {};
        for (var i = 0; i < stylesToGet.length; i++) {
            var styleName = stylesToGet[i];
            styles[styleName] = eleStyle[styleName];
        }
        return styles;
    }

    /**
     * Return the width of the text
     * @param {HTMLElement} element - text/title element
     * @returns {String} - Width in pixels
     */
    function getTextWidth(element) {
        var text = element.textContent;
        var stylesToCopy = ['font-size', 'font-weight', 'text-transform', 'padding', 'white-space', 'font-family'];
        var ruler = _document.createElement('span');
        // Copy the element's styles to the ruler element
        getElementStyles(element, stylesToCopy, ruler.style);
        ruler.textContent = text;
        ruler.style.position = 'absolute';
        ruler.style.top = '10000px';
        ruler.style.left = '-10000px';
        _document.body.appendChild(ruler);
        var width = ruler.offsetWidth;
        _document.body.removeChild(ruler);
        return width;
    }

    // If hud message is already up, return.
    if (HudMessage.instances.length > 0)
        return ;

    var msgTitle = messageSpecs.msgTitleKey;
    var msgTitleDefault = messageSpecs.msgTitleDefaultValue || msgTitle;
    var message    = messageSpecs.messageKey;
    var messageDefault = messageSpecs.messageDefaultValue || message ;
    var buttonText = messageSpecs.buttonText;
    var checkboxChecked = messageSpecs.checkboxChecked || false;
    var position = messageSpecs.position || 'center';

    var hudMessage = _document.createElement("div");
    hudMessage.classList.add("docking-panel");
    hudMessage.classList.add("hud");
    if (position === 'top') {
        hudMessage.classList.add("top");
    }

    container.appendChild( hudMessage );

    if (msgTitle) {
        var title = _document.createElement("div");
        title.classList.add("docking-panel-title");
        title.classList.add("docking-panel-delimiter-shadow");
        title.textContent = i18n.t(msgTitle, {"defaultValue" : msgTitleDefault});
        title.setAttribute("data-i18n", msgTitle);
        hudMessage.appendChild(title);

        var closeButton;
        if (closeCB) {
            closeButton = _document.createElement("div");
            closeButton.classList.add("docking-panel-close");
            closeButton.addEventListener('click', function(e) {
                HudMessage.dismiss();
                if (closeCB)
                    closeCB(e);
            });
            hudMessage.appendChild(closeButton);
        }

        var titleStyle = getElementStyles(title, ['width', 'font-size']);
        var titleWidth = getTextWidth(title);
        var fontSize = parseFloat(titleStyle['font-size']);
        // Take into account the close button. The title should not overlap it.
        var closeButtonWidth = closeButton ? parseFloat(getElementStyles(closeButton, 'width')) : 0;
        // Title cannot overlap the close button
        var defaultTitleWidth = parseFloat(titleStyle['width']) - closeButtonWidth;
        // Calculate the font-size and assign it to the title
        title.style['font-size'] = titleWidth > defaultTitleWidth ? `${defaultTitleWidth / titleWidth * fontSize}px`: `${fontSize}px`;
    }
    var client = _document.createElement("div");
    client.classList.add("hud-client");
    client.classList.add("docking-panel-container-solid-color-b");
    
    hudMessage.appendChild(client);

    var text = _document.createElement("div");
    text.className = "hud-message";
    text.textContent = i18n.t(message, { "defaultValue" : messageDefault});
    text.setAttribute("data-i18n", messageDefault);
    client.appendChild(text);

    var clientHeight = getClientHeight(text);
    if (buttonCB) {
        var button = _document.createElement("div");
        button.classList.add("docking-panel-primary-button");
        button.classList.add("hud-button");
        button.textContent = i18n.t( buttonText, { "defaultValue" : buttonText } );
        button.setAttribute( "data-i18n", buttonText );
        button.addEventListener("click", buttonCB);
        client.appendChild(button);
        clientHeight += getClientHeight(button);
    }

    if (checkboxCB) {
        var checkbox = _document.createElement("div");
        var cb = _document.createElement("input");
        cb.className = "hud-checkbox";
        cb.type = "checkbox";
        cb.checked = checkboxChecked;
        checkbox.appendChild(cb);

        var checkboxText = "Do not show this message again";    // localized below

        var lbl = _document.createElement("label");
        lbl.setAttribute('for', checkboxText);
        lbl.setAttribute("data-i18n", checkboxText);
        lbl.textContent = i18n.t( checkboxText, { "defaultValue" : checkboxText } );
        checkbox.appendChild(lbl);
        cb.addEventListener( "change", checkboxCB );
        client.appendChild(checkbox);
        clientHeight += getClientHeight(checkboxCB);
    }

    client.style.height =  clientHeight + 'px';
    hudMessage.style.height = (clientHeight + (title ? getClientHeight(title) : 0)) + 'px';

    var instance = { hudMessage: hudMessage, container: container };
    HudMessage.instances.push(instance);
};

HudMessage.dismiss = function() {
    // dismiss the topmost alert box
    if (HudMessage.instances.length > 0) {
        var instance = HudMessage.instances.pop();
        instance.hudMessage.style.visibility = "hidden";
        instance.container.removeChild(instance.hudMessage);
        return true;
    }
    return false;
};
