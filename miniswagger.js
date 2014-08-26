/* jshint node: true */

var node = typeof window === 'undefined';
var browser = typeof window !== 'undefined';

var request;
if (browser) request = require('browser-request');
else request = require('request');

var _;
if (node) _ = require('lodash'); else _ = window._;

var Promise;
if (node) Promise = require('promise'); else Promise = window.Promise;

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
                        reject(response);
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

module.exports = {
    SwaggerResource: SwaggerResource
};
