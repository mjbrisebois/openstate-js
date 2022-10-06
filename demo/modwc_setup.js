
const { createModWC }			= ModWC;

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


export const modwc			= new createModWC({
    "strict": true,
    "reactive": Vue.reactive,
});

modwc.addHandlers({
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

	    this.state[ `post/${data.id}` ] = result;

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
	validation ( data, errors ) {
	    if ( data.message === undefined )
		errors.push(`'message' is required`);
	    else if ( typeof data.message !== "string" )
		errors.push(`'message' must be a string`);

	    if ( data.message.trim() === "" )
		errors.push(`'message' cannot be empty`);
	},
	async asyncValidation ( data, errors ) {
	    await delay( data.metadata?.delay || 10 );

	    if ( data.metadata?.foo )
		errors.push("metadata issue");
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
		this.state[`post/${post.id}`] = post;
	    }

	    console.log("all posts response:", list );
	    return list;
	},
    },
});


HTMLElement.prototype.$modwc		= modwc;
