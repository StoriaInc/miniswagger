/* jshint globalstrict: true, node: true, browser: true  */
"use strict";

var specs = require('./api-specs').default;

var miniswagger = require('miniswagger').default;

var Api = new miniswagger.fromSpecs(specs);

Api.core.getStory({id: '0689a05650017f80'}).then(
    function(story) {
        console.log(story);
    },
    function(error) {
        console.error(error);
    }
);

