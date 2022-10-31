[README.md](../README.md)


## API

```js
const OpenState = require('openstate');

OpenState.create({
    "strict": true,
    "reactive": Vue.reactive,
});

openstate.addHandlers({
    "Post": {
        "path": "post/:id",
        async read ({ id }) {
            return await client.get(`post/${id}`);
        },
        async create ( input ) {
            const result = await client.create(`post/${id}`, input );

            this.openstate.state[ `post/${result.id}` ] = result;

            return result;
        },
        async update ({ id }, changed ) {
            return await client.update(`post/${id}`, changed );
        },
        validation ( data, rejections ) {
            if ( data.message === undefined )
                rejections.push(`'message' is required`);
        },
    },
});
```
