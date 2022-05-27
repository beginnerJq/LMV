
export function ProgressBar(container) {

    let _document = container.ownerDocument;
    
    this.bg = _document.createElement('div');
    this.bg.className = 'progressbg';

    this.fg = _document.createElement('div');
    this.fg.className = 'progressfg';

    this.bg.appendChild(this.fg);
    container.appendChild(this.bg);

    this.lastValue = -1;

    this.fg.style.transform = `scale(0, 1)`;
}

ProgressBar.prototype.setPercent = function(pct) {

    if (pct == this.lastValue)
        return;

    this.lastValue = pct;

    if (pct >= 99) {
        this.bg.style.opacity = "0";
    } else {
        this.bg.style.opacity = "1";
        this.fg.style.transform = `scale(${pct / 100}, 1)`;
    }
};

ProgressBar.prototype.setStyle = function(style) {
    !this.fg.classList.contains(style) && this.fg.classList.add(style);
};

ProgressBar.prototype.removeStyle = function(style) {
    this.fg.classList.contains(style) && this.fg.classList.remove(style);
};
