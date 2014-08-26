/* jshint globalstrict: true, node: true */

"use strict";

var miniswagger = require('miniswagger');

var util = require('util');
var inspect = function(x) { util.inspect(x, {depth: 8, colors: true }); };

var Api = new miniswagger.fromUrl('https://spec.selfishbeta.com/selfish/apis');

Api.ready.then(
    function() {
        Api.core.getStory({id: '0689a05650017f80'})
        .then(function(v) {console.log (v); });
    },

    function(error) {
        console.log(error);
    }
);
