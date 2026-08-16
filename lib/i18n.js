'use strict';

// homey.__() resolves the key but leaves {{tokens}} in the string untouched —
// verified on Homey Pro 2023, where a pairing message reached the phone reading
// "Fant {{name}}, men den er allerede lagt til". Rather than trust the platform
// with the substitution, do it here.
//
// An unknown token is left alone rather than blanked: "{{profile}}" on screen
// says a token is missing, while an empty gap silently loses information.

const fillTokens = (text, tokens) => {
  if (!tokens) return text;
  return String(text).replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (placeholder, name) => (
      Object.prototype.hasOwnProperty.call(tokens, name)
        ? String(tokens[name])
        : placeholder
    ),
  );
};

// homey is any object with __(); tokens is optional.
const translate = (homey, key, tokens = null) => {
  let text;
  try {
    text = homey.__(key);
  } catch (error) {
    text = key;
  }
  // A missing key comes back as the key itself in Homey.
  if (text === undefined || text === null) text = key;
  return fillTokens(text, tokens);
};

module.exports = { translate, fillTokens };
