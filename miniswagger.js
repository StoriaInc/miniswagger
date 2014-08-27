/* jshint node: true, browser: true */

"use strict";

var node = typeof window === 'undefined';
var browser = typeof window !== 'undefined';

var request;
if (browser) request = require('browser-request');
else request = require('request');

var _;
if (node) _ = require('lodash'); else _ = window._;

var Promise;
if (node) Promise = require('promise'); else Promise = window.Promise;

function fetchSpec(url) {
    console.log(">>>", url);
    return new Promise(function(resolve, reject) {
        request({
            url: url,
            json: true
        }, function(err, response, body) {
            if (err) reject(err);
            else resolve(body);
        });
    });
}

function fetchSpecs(url) {
    return fetchSpec(url).then(function(specs) {
        var paths = specs.apis.map(function(x) {return specs.basePath + x.path;} );
        return Promise.all(paths.map(fetchSpec));
    });
}

var SwaggerResource = function(spec) {
    this.paths = {};
    this.operations = {};

    function interpolate(path, params){
        var replacements = path.match(/\{\w+\}/g);

        if (replacements) {
            replacements.forEach(function(r) {
                var id = r.replace(/^\{/, '').replace(/\}$/, '');
                if (params[id]) {
                    path = path.replace(r, params[id]);
                    delete params[id];
                }
                else throw new Error("swagger path parameter " + id + " is undefined");
            });
        }
        return path;
    }

    function makePromise(operation) {
        return (function(params) {
            params = JSON.parse(JSON.stringify(params));
            var op = this.operations[operation];

            var req = {
                url: spec.basePath + interpolate(op.path, params),
                method: op.httpMethod,
                headers:  { accept: "application/json, text/plain" },
                json: true,
                gzip: true,
                jar: this.jar // browser-request ignores this, so it's safe to have here
            };

            if (['POST', 'DELETE', 'PATCH', 'PUT'].indexOf(op.httpMethod) > -1)
                req.json = params;
            else
                req.qs = params;

            return new Promise(function (resolve, reject) {
                request(req, function(err, response, body) {
                    function handleError() {
                        console.error('API error', response.statusCode, response.body);

                        if (op.responseMessages) {
                            op.responseMessages
                                .filter(function(x) { return x.code === response.statusCode; })
                                .forEach(function(e){ console.error(e.message); });
                        }

                        // TODO: properly reject the promise
                        //       once Atlant is ready for this
                        
                        // reject(response);
                        resolve({
                            status: response.statusCode,
                            response: response
                        });
                    }

                    if (err || response.statusCode !== 200) handleError();
                    else resolve({obj: JSON.parse(_.unescape(JSON.stringify(body)))});
                });
            });
        }).bind(this);
    }

    spec.apis.forEach(
        function(api) {
            api.operations.forEach(
                function(op) {
                    if (!this.paths[api.path]) this.paths[api.path] = {};
                    this.paths[api.path][op.httpMethod] = this.operations[op.nickname] = op;
                    op.path = api.path;
                }, this
            );
        }, this
    );

    Object.keys(this.operations).forEach(function(op) {
        this[op] = makePromise.bind(this)(op);
    }, this);

    return this;
};

var fromUrl = function(url) {
    console.log('fetching apis from', url);

    var self = this;
    if (node) self.jar = request.jar();

    this.ready = new Promise(function(resolve, reject) {
        fetchSpecs(url)
            .then(
                function(specs){
                    // console.log(specs);
                    specs.map(function(spec) {
                        self[spec.resourcePath.replace(/^\//, '')] = new SwaggerResource(spec);
                        if (self.jar) self[spec.resourcePath.replace(/^\//, '')].jar = self.jar;
                    });

                    console.log('API ready.');
                    resolve();
                },
                function(error) {
                    console.error(error);
                    reject(error);
                }
            );
    });

    return this;
};

var fromSpecs = function(specs) {
    var self = this;
    if (node) self.jar = request.jar();

    Object.keys(specs).forEach(function(spec) {
        self[spec] = new SwaggerResource(specs[spec]);
        if (self.jar) self[spec].jar = self.jar;
    });

    return this;
};

module.exports.default = {
    SwaggerResource: SwaggerResource,
    fromUrl: fromUrl,
    fromSpecs: fromSpecs
};
