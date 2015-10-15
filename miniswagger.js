/* jshint node: true, browser: true */
"use strict";

var miniswagger = function(options){
    var timeFirst, timeEnd;
    var cache = {};
    if(!('cacheExpire' in options)) options.cacheExpire = 20000;
    if(!('debug' in options)) options.debug = false;
    options.headers = options.headers || {};

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
            return (function(params, additionalHeaders) {
                if (!timeFirst) timeFirst = now();

                params = JSON.parse(JSON.stringify(params || {})); // clone the params object
                var op = this.operations[operation];

                var defaultHeaders = _.extend({
                    accept: "application/json, text/plain",
                    "content-type": "application/json; charset=UTF-8"
                }, options.headers);

                var headers = ( additionalHeaders ) ? _.extend( defaultHeaders, additionalHeaders ) : defaultHeaders;

                var req = {
                    url: spec.basePath + interpolate(op.path, params),
                    method: op.httpMethod,
                    headers:  headers,
                    json: false,
                    gzip: true,
                    withCredentials: true,
                    jar: parent.jar // browser-request ignores this, so it's safe to have here
                };

                var body = {}
                var qs = {}

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


                function key (req){
                    return req.url + JSON.stringify(req.qs)
                }

                var justNow = now();
                if ( 'GET' === req.method && key(req) in cache && (justNow - cache[key(req)].date <= options.cacheExpire)) {
                    log('--- cache: HIT', req.url, justNow - cache[key(req)].date);
                    return new Promise(function(resolve, reject){
                        resolve(cache[key(req)].value)
                    })
                } else {
                    if(!cache[key(req)]) log('--- cache: MISS', req.url, req.qs)
                    if(cache[key(req)]) {
                        log('--- cache: EXPRIRED', req.url, (justNow - cache[key(req)].date))
                        delete cache[key(req)]
                    }
                };

                var serialize = function(obj) {
                    var str = [];
                    for(var p in obj)
                        if (obj.hasOwnProperty(p)) {
                            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
                        }
                    return str.join("&");
                }

                if(req.qs){
                    var qs = (typeof req.qs == 'string')? req.qs : serialize(req.qs);
                    if(req.url.indexOf('?') !== -1){ //no get params
                        req.url = req.url+'&'+qs;
                    }else{ //existing get params
                        req.url = req.url+'?'+qs;
                    }
                    req.qs = void 0;
                }

                return new Promise(function (resolve, reject) {
                    request(req, function(err, response, body) {

                        var headers = response.getAllResponseHeaders().split("\n").reduce( function(acc, i) { 
                            var colon = i.indexOf(':');
                            var key = i.substring(0, colon) 
                            var value = i.substring(colon+1, i.length).trim('')
                            if(key) acc[key] = value;
                            return acc
                        }, {});

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
                                headers: headers,
                                response: response
                            })

                            else resolve({
                                status: response.statusCode,
                                headers: headers,
                                response: response
                            });
                        }

                        if (err || response.statusCode !== 200) handleError();
                        else {
                            if (!body.length) {
                                console.error('Warning: Empty response from backend')
                                body = '{}'
                            }

                            var value = {
                                headers: headers
                            }

                            try{
                                value.obj = JSON.parse(body);
                            } catch(e) {
                                console.error(e.stack)
                            }
                            timeEnd = now();
                            log('lastTime:', req.url, timeEnd - timeFirst);

                            if ('GET' === req.method) {
                                cache[key(req)] = {};
                                cache[key(req)].value = value;
                                cache[key(req)].date = now()
                                log('cache: SET', req.url, cache[key(req)].date)
                            }

                            resolve(value)
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


