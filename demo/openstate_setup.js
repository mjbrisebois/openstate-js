
OpenState.logging();

const delay				= (ms=0) => new Promise(f => setTimeout(f,ms));
const database				= {
    "123456788": {
	"id": 123456788,
	"message": "Hello world!",
    },
};

let __id				= 123456789;
function new_id () {
    return __id++;
}


export const openstate			= new OpenState.create({
    "strict": true,
    "reactive": Vue.reactive,
});

openstate.addHandlers({
    "Post": {
	"path": "post/:id",
	async read ({ id }) {
	    await delay( 1000 * Math.random() );

	    if ( database[ id ] === undefined )
		return null;

	    return Object.assign( {}, database[ id ] );
	},
	async create ( data ) {
	    await delay( 1000 * Math.random() );

	    data.id			= new_id();

	    database[ data.id ]		= data;

	    const result		= Object.assign( {}, database[ data.id ] );

	    this.openstate.state[ `post/${data.id}` ] = result;

	    console.log("wrote new post:", result, database );
	    return result;
	},
	async update ({ id }, data ) {
	    await delay( 1000 * Math.random() );

	    Object.assign( database[ id ], data );

	    return Object.assign( {}, database[ id ] );
	},
	defaultMutable () {
	    return {
		"message": "",
	    };
	},
	async validation ( data, rejections ) {
	    if ( data.message === undefined )
		rejections.push(`'message' is required`);
	    else if ( typeof data.message !== "string" )
		rejections.push(`'message' must be a string`);

	    if ( data.message.trim() === "" )
		rejections.push(`'message' cannot be empty`);

	    await delay( data.metadata?.delay || 10 );

	    if ( data.metadata?.foo )
		rejections.push("metadata issue");
	},
    },
    "Posts": {
	"path": "all/posts",
	"readonly": true,
	async read () {
	    await delay( 1000 * Math.random() );

	    const list			= Object.values( database )
		  .map( p => Object.assign( {}, p ) );

	    for ( let post of list ) {
		this.openstate.state[`post/${post.id}`] = post;
	    }

	    console.log("all posts response:", list );
	    return list;
	},
    },
});


HTMLElement.prototype.$openstate	= openstate;
