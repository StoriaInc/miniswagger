/* jshint node: true, browser: true */
"use strict";

var miniswagger = function(options){
    var timeFirst, timeEnd;
    var cache = {};
    if(!('cacheExpire' in options)) options.cacheExpire = 20000;
    if(!('debug' in options)) options.debug = false;

    var log = function(){}

    if (options.debug)
        log = console.log.bind(console)
    
    log('cache: expire at:', options)


    var node = typeof window === 'undefined';

    var request, _, Promise;
    var now = function(){
        return 'undefined' !== typeof performance ? performance.now() : new Date().getTime()
    }

    if (!node) {
        request = window.request;
        _ = window._;
        Promise = window.Promise;
    } else {
        request = require('request');
        _ = require('lodash');
        Promise = require('promise');
    }

    function fetchSpec(url) {
        log(">>>", url);
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

    var SwaggerResource = function(parent, spec) {
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

        function makePromise(operation, models) {
            return (function(params) {
                if (!timeFirst) timeFirst = now();

                params = JSON.parse(JSON.stringify(params || {})); // clone the params object
                var op = this.operations[operation];

                var req = {
                    url: spec.basePath + interpolate(op.path, params),
                    method: op.httpMethod,
                    headers:  {
                        accept: "application/json, text/plain",
                        "content-type": "application/json; charset=UTF-8"
                    },
                    json: false,
                    gzip: true,
                    withCredentials: true,
                    jar: parent.jar // browser-request ignores this, so it's safe to have here
                };

                var body = {}
                var qs = {}

                var justNow = now();
                if ( 'GET' === req.method && req.url in cache && (justNow - cache[req.url].date <= options.cacheExpire)) {
                    log('--- cache: HIT', req.url, justNow - cache[req.url].date);
                    return new Promise(function(resolve, reject){ 
                        resolve(cache[req.url].value)
                    })
                } else { 
                    if(!cache[req.url]) log('--- cache: MISS', req.url)
                    if(cache[req.url]) { 
                        log('--- cache: EXPRIRED', req.url, (justNow - cache[req.url].date))
                        delete cache[req.url]
                    }
                };

                Object.keys(params).map(function(p) {
                    var paramType;

                    var pp = _.find(this.operations[operation].parameters, function(x) { return x.name === p})
                    if (!!pp) paramType = pp.paramType
                    else {
                        pp = _.find(
                            this.operations[operation].parameters.filter( function(prm) { return prm.type in spec.models }), function(prm) { return p in spec.models[prm.type].properties })
                        if (typeof pp !== 'undefined') {
                            paramType = pp.paramType
                        } else {
                            log("Warning: cannot deduce parameter type. Guessing.", operation, p)
                        }
                    }
                    if (paramType === 'body' || (['POST', 'DELETE', 'PATCH', 'PUT'].indexOf(op.httpMethod) > -1)) body[p] = params[p]
                    else qs[p] = params[p]
                }, this)

                req.body = JSON.stringify(body)
                req.qs = qs

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
                            if (response.statusCode === 0) reject({
                                status: response.statusCode,
                                response: response
                            })

                            else resolve({
                                status: response.statusCode,
                                response: response
                            });
                        }

                        if (err || response.statusCode !== 200) handleError();
                        else {
                            if (!body.length) {
                                console.error('Warning: Empty response from backend')
                                body = '{}'
                            }

                            var obj;
                            try{
                                obj = JSON.parse(body);
                            } catch(e) {
                                console.error(e.stack)
                            }
                            timeEnd = now();
                            log('lastTime:', req.url, timeEnd - timeFirst);

                            if ('GET' === req.method) {
                                cache[req.url] = {};
                                cache[req.url].value = {obj: obj};
                                cache[req.url].date = now()
                                log('cache: SET', req.url, cache[req.url].date)
                            }

                            resolve({obj: obj})
                        }
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
            this[op] = makePromise.bind(this)(op, spec.models);
        }, this);

        return this;
    };

    var fromUrl = function(url) {
        log('fetching apis from', url);

        var self = this;
        if (node) self.jar = request.jar();

        this.ready = new Promise(function(resolve, reject) {
            fetchSpecs(url)
                .then(
                    function(specs){
                        // log(specs);
                        specs.map(function(spec) {
                            self[spec.resourcePath.replace(/^\//, '')] = new SwaggerResource(self, spec);
                        });

                        log('API ready.');
                        resolve();
                    },
                    function(error) {
                        console.error(error.stack);
                        reject(error);
                    }
                )
                .catch(function(err) {
                    console.error(err.stack)
                });
        });

        return this;
    };

    var fromSpecs = function(specs) {
        var self = this;
        if (node) self.jar = request.jar();

        Object.keys(specs).forEach(function(spec) {
            self[spec] = new SwaggerResource(self, specs[spec]);
            if (self.jar) self[spec].jar = self.jar;
        });

        return this;
    };

    var destroy = function(){
        cache = {};
    }

    return {
        SwaggerResource: SwaggerResource,
        fromUrl: fromUrl,
        fromSpecs: fromSpecs,
        destroy: destroy
    };


}

if ('undefined' !== typeof window) {
    window.miniswagger = { default: miniswagger };
} else {
    module.exports.default = miniswagger;
}


