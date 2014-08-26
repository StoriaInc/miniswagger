/* jshint globalstrict: true, node: true, browser: true  */
"use strict";

var specs = require('./api-specs').default;

var miniswagger = require('miniswagger').default;

var Api = new miniswagger.fromSpecs(specs);

Api.acl.auth({
    authAccountId: 'sergey.urzhumskov@frumatic.com',
    password: '123456',
    authType: 'Selfish',
    remember: false
})
    .then(
        function(authData) {
            console.log(authData);
            return Api.core.getUser({ id: authData.obj.accountId});
        }
    )
    .then(
        function(profile) {
            console.log(profile.obj);
            return Api.core.getStory({id: '0689a05650017f80'});
        }
    )
    .then(
        function(story) {
            console.log(story.obj);

            console.log(Api.jar); // check that the auth cookie is set
        },
        function(error) {
            console.error(error);
        }
    );

