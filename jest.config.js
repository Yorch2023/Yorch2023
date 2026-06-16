'use strict';

module.exports = {
    testEnvironment: 'node',
    testMatch:       ['**/tests/**/*.test.js'],
    testTimeout:     15000,
    coverageThreshold: {
        global: {
            lines:      60,
            functions:  60,
            branches:   50,
            statements: 60,
        },
    },
};
