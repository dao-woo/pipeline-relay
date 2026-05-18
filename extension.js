// Composition root — delegates to Relay core

const core = require('./src/core');

function activate(context) {
    core.activate(context);
}

function deactivate() {
    core.deactivate();
}

module.exports = { activate, deactivate };
