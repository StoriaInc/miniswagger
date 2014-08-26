# `miniswagger`

## Installation

```bash
npm install git+https://github.com/SelfishInc/miniswagger
```

## Usage

Works through `browserify`

```javascript
var miniswagger = require('miniswagger');
```

### Fetching specs from remote server

```javascript
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
```

### Using spec from JSON







