// ===== Credit Stamp — עסק ללא מתחרים =====
// Single source of truth for the "built by Hillel" footer, injected on every page.
// Self-contained: appends its own <style> + <footer>. No dependencies, no placeholder needed.
// Matches the Liquid Glass dark+gold theme. RTL.
(function () {
  if (document.getElementById('hilel-credit-stamp')) return;

  var WA = 'https://wa.me/972549116092';

  var css = '' +
    '#hilel-credit-stamp{' +
    'position:relative;width:100%;box-sizing:border-box;' +
    'margin-top:48px;padding:18px 16px;' +
    'text-align:center;direction:rtl;' +
    "font-family:'Heebo',system-ui,sans-serif;font-size:13px;line-height:1.6;" +
    'color:rgba(232,241,242,.62);' +
    'background:rgba(0,30,38,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
    'border-top:1px solid rgba(212,175,55,.32);z-index:5;}' +
    '#hilel-credit-stamp .hcs-name{color:#D4AF37;font-weight:600;text-decoration:none;' +
    'border-bottom:1px solid transparent;transition:border-color .2s ease;}' +
    '#hilel-credit-stamp .hcs-name:hover{border-bottom-color:#D4AF37;}' +
    '#hilel-credit-stamp .hcs-sep{margin:0 8px;opacity:.4;}' +
    '#hilel-credit-stamp .hcs-cta{color:rgba(232,241,242,.85);text-decoration:none;}' +
    '#hilel-credit-stamp .hcs-cta:hover{color:#D4AF37;}' +
    '#hilel-credit-stamp .hcs-spark{color:#D4AF37;margin-inline-end:6px;}' +
    '@media(max-width:520px){#hilel-credit-stamp .hcs-sep{display:block;height:4px;margin:6px 0;}' +
    '#hilel-credit-stamp .hcs-sep::before{content:"";}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var footer = document.createElement('footer');
  footer.id = 'hilel-credit-stamp';
  footer.setAttribute('dir', 'rtl');
  footer.setAttribute('role', 'contentinfo');
  footer.innerHTML =
    '<span class="hcs-spark">✦</span>' +
    'נבנה ופותח על ידי ' +
    '<a class="hcs-name" href="' + WA + '" target="_blank" rel="noopener" ' +
    'aria-label="הלל אקנין — צרו קשר בוואטסאפ">הלל אקנין</a>' +
    '<span class="hcs-sep">·</span>' +
    '<a class="hcs-cta" href="' + WA + '" target="_blank" rel="noopener">' +
    'רוצים מערכת כזו לעסק שלכם?</a>';

  document.body.appendChild(footer);
})();
