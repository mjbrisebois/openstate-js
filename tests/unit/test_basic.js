const log				= require('@whi/stdlog')( __filename.split('/').slice(-1)[0], {
    level: process.env.LOG_LEVEL || 'fatal',
});

const { expect }			= require('chai');
const { v4: uuid }			= require('uuid');

const OpenState				= require('../../src/main.js');

OpenState.logging( process.env.LOG_LEVEL ? process.env.LOG_LEVEL.replace("silly", "trace") : "error" );

const delay				= ms => new Promise(f => setTimeout(f, ms));

let __id				= 123456789;
function new_id () {
    return __id++;
}
const EXAMPLE_POST			= {
    "message": "Hello, World!",
    "metadata": {
	// "foo": "bar",
    },
};
const database				= {};

function reactive ( value ) {
    return new Proxy( value, {
	get ( target, prop ) {
	    if ( prop === "__reactive__" )
		return true;

	    return Reflect.get( ...arguments );
	},
    });
}

const openstate				= new OpenState.create({
    reactive,
    "strict": true,
});

openstate.addHandlers({
    "Post": {
	"path": "post/:id",
	async read ({ id }) {
	    if ( database[ id ] === undefined )
		return null;

	    return Object.assign( {}, database[ id ] );
	},
	async create ( input ) {
	    input.id			= new_id();

	    database[ input.id ]	= input;

	    return Object.assign( {}, database[ input.id ] );
	},
	async update ({ id }, changed ) {
	    Object.assign( database[ id ], changed );

	    return Object.assign( {}, database[ id ] );
	},
	defaultMutable () {
	    return {
		"message": "default message",
	    };
	},
	async validation ( data, rejections ) {
	    if ( data.message === undefined )
		rejections.push(`'message' is required`);
	    else if ( typeof data.message !== "string" )
		rejections.push(`'message' must be a string`);

	    await delay( data.metadata?.delay || 10 );

	    if ( data.metadata?.foo )
		rejections.push("metadata issue");
	},
    },
    "Posts": {
	"path": "all/posts",
	"readonly": true,
	async read () {
	    const list			= Object.values( database );

	    for ( let post of list ) {
		this.openstate.state[`post/${post.id}`] = post;
	    }

	    return list;
	},
    },
});


function basic_tests () {

    it("should check reactive wrapper", async function () {
	expect( openstate.state.__reactive__ ).to.be.true;
    });

    it("should get a valid path", async function () {
	const path			= `post/${uuid()}`;
	const metastate			= openstate.metastate[ path ];

	expect( metastate.current	).to.be.false;
	expect( metastate.present	).to.be.false;
    });

    let post;

    it("should create a path", async function () {
	const path			= `post/${uuid()}`;
	const metastate			= openstate.metastate[ path ];
	const input			= openstate.mutable[ path ];

	Object.assign( input, EXAMPLE_POST );

	const p				= openstate.write( path ).catch(err => console.error(err));

	// console.log( openstate );

	expect( metastate.current	).to.be.false;
	expect( metastate.present	).to.be.false;
	expect( metastate.writing	).to.be.true;

	await p;

	// console.log( openstate );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.false;

	const data			= openstate.state[ path ];

	expect( data.id			).to.equal( 123456789 );
	expect( data.message		).to.equal("Hello, World!");

	openstate.state[`post/${data.id}`]	= data;
	post				= data;
    });

    it("should read a path", async function () {
	const path			= `post/${post.id}`;
	const metastate			= openstate.metastate[ path ];

	const p				= openstate.read( path ).catch(err => console.error(err));

	// console.log( openstate );

	expect( metastate.current	).to.be.false;
	expect( metastate.present	).to.be.true;
	expect( metastate.reading	).to.be.true;

	// console.log( openstate );

	await p;

	// console.log( openstate );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.reading	).to.be.false;

	const data			= openstate.state[ path ];

	expect( data.id			).to.equal( post.id );
	expect( data.message		).to.equal( post.message );

	// console.log( openstate );
    });

    it("should update a path", async function () {
	const path			= `post/${post.id}`;
	const metastate			= openstate.metastate[ path ];
	const input			= openstate.mutable[ path ];

	expect( metastate.changed	).to.be.false;

	input.metadata.foo		= "bing";

	expect( metastate.changed	).to.be.true;

	delete input.metadata.foo;

	expect( metastate.changed	).to.be.false;

	input.message			= "Updated!";

	expect( metastate.changed	).to.be.true;

	const p				= openstate.write( path ).catch(err => console.error(err));

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.true;

	// console.log( openstate );

	await p;

	// console.log( openstate );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.false;

	const data			= openstate.state[ path ];

	expect( data.id			).to.equal( 123456789 );
	expect( data.message		).to.equal("Updated!");
    });

    it("should get all posts", async function () {
	const id			= new_id();
	database[ id ]			= {
	    id,
	    "message": "New post record",
	};

	await openstate.read("all/posts");

	const path			= `post/${id}`;
	const metastate			= openstate.metastate[ path ];

	expect( metastate.present	).to.be.true;
    });

    it("should check validity", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= openstate.metastate[ path ];

	database[ id ]			= {
	    id,
	    "message": "Valid record from origin",
	};

	expect( metastate.valid		).to.be.false;
	expect( metastate.invalid	).to.be.true;

	const mutable			= openstate.mutable[ path ];

	expect( metastate.valid		).to.be.true;
	expect( metastate.invalid	).to.be.false;

	expect( metastate.present	).to.be.false;

	await openstate.read( path, { allowMergeConflict: true });

	expect( metastate.present	).to.be.true;
	expect( metastate.valid		).to.be.true;
	expect( metastate.invalid	).to.be.false;

	delete mutable.message;

	expect( metastate.valid		).to.be.false;
	expect( metastate.invalid	).to.be.true;

	const rejections		= openstate.rejections[ path ];

	expect( rejections		).to.have.length( 1 );
	expect( rejections[0]		).to.have.string("'message' is required");

	mutable.metadata		= {
	    "foo": "bar",
	};

	await openstate.validation( path );

	expect( rejections		).to.have.length( 2 );
	expect( rejections[1]		).to.have.string("metadata issue");
    });

    it("should discard outdated async validation", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= openstate.metastate[ path ];
	const mutable			= openstate.mutable[ path ];

	expect( metastate.valid		).to.be.true;

	delete mutable.message;

	expect( metastate.valid		).to.be.false;

	Object.assign( mutable, {
	    "metadata": {
		"delay": 20,
	    },
	});

	expect( metastate.valid		).to.be.false;

	mutable.metadata		= {
	    "foo": "bar",
	    "delay": 10,
	};

	await openstate.validation( path );

	expect( metastate.valid		).to.be.false;
    });

    it("should have merge conflict", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= openstate.metastate[ path ];

	database[ id ]			= {
	    id,
	    "message": "Valid record from origin",
	};

	const mutable			= openstate.mutable[ path ];

	mutable.message			= "force merge conflict";

	expect( metastate.changed	).to.be.true;

	let failed			= false;
	try {
	    await openstate.read( path );
	} catch (err) {
	    failed			= true;

	    expect( err.message		).to.have.string("merge conflict");
	}

	expect( failed			).to.be.true;
    });

}

describe("Unit", () => {
    describe("OpenState", basic_tests );
});
