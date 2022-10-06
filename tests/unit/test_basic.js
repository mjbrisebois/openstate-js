const log				= require('@whi/stdlog')( __filename.split('/').slice(-1)[0], {
    level: process.env.LOG_LEVEL || 'fatal',
});

const { expect }			= require('chai');
const { v4: uuid }			= require('uuid');

const { createModWC,
	...ModWC }			= require('../../src/main.js');

ModWC.logging( process.env.LOG_LEVEL ? process.env.LOG_LEVEL.replace("silly", "trace") : "error" );

const delay				= ms => new Promise(f => setTimeout(f, ms));

let __id				= 123456789;
function new_id () {
    return __id++;
}
const EXAMPLE_POST			= {
    "message": "Hello, World!",
    "metadata": {
	"foo": "bar",
    },
};
const database				= {};

const modwc				= new createModWC({
    "strict": true,
});

modwc.addHandlers({
    "Post": {
	"path": "post/:id",
	async read ({ id }) {
	    if ( database[ id ] === undefined )
		return null;

	    return Object.assign( {}, database[ id ] );
	},
	async create ( data ) {
	    data.id			= new_id();

	    database[ data.id ]		= data;

	    return Object.assign( {}, database[ data.id ] );
	},
	async update ({ id }, data ) {
	    Object.assign( database[ id ], data );

	    return Object.assign( {}, database[ id ] );
	},
	defaultMutable () {
	    return {
		"message": "default message",
	    };
	},
	validation ( data, errors ) {
	    if ( data.message === undefined )
		errors.push(`'message' is required`);
	    else if ( typeof data.message !== "string" )
		errors.push(`'message' must be a string`);
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
	    const list			= Object.values( database );

	    for ( let post of list ) {
		this.state[`post/${post.id}`] = post;
	    }

	    return list;
	},
    },
});


function basic_tests () {

    it("should get a valid path", async function () {
	const path			= `post/${uuid()}`;
	const metastate			= modwc.metastate[ path ];

	expect( metastate.current	).to.be.false;
	expect( metastate.present	).to.be.false;
    });

    let post;

    it("should create a path", async function () {
	const path			= `post/${uuid()}`;
	const metastate			= modwc.metastate[ path ];
	const input			= modwc.mutable[ path ];

	Object.assign( input, EXAMPLE_POST );

	const p				= modwc.write( path ).catch(err => console.error(err));

	// console.log( modwc );

	expect( metastate.current	).to.be.false;
	expect( metastate.present	).to.be.false;
	expect( metastate.writing	).to.be.true;

	await p;

	// console.log( modwc );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.false;

	const data			= modwc.state[ path ];

	expect( data.id			).to.equal( 123456789 );
	expect( data.message		).to.equal("Hello, World!");

	modwc.state[`post/${data.id}`]	= data;
	post				= data;
    });

    it("should read a path", async function () {
	const path			= `post/${post.id}`;
	const metastate			= modwc.metastate[ path ];

	const p				= modwc.read( path ).catch(err => console.error(err));

	// console.log( modwc );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.reading	).to.be.true;

	// console.log( modwc );

	await p;

	// console.log( modwc );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.reading	).to.be.false;

	const data			= modwc.state[ path ];

	expect( data.id			).to.equal( post.id );
	expect( data.message		).to.equal( post.message );

	// console.log( modwc );
    });

    it("should update a path", async function () {
	const path			= `post/${post.id}`;
	const metastate			= modwc.metastate[ path ];
	const input			= modwc.mutable[ path ];

	expect( metastate.changed	).to.be.false;

	input.metadata.foo		= "bing";

	expect( metastate.changed	).to.be.true;

	input.metadata.foo		= "bar";

	expect( metastate.changed	).to.be.false;

	input.message			= "Updated!";

	expect( metastate.changed	).to.be.true;

	const p				= modwc.write( path ).catch(err => console.error(err));

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.true;

	// console.log( modwc );

	await p;

	// console.log( modwc );

	expect( metastate.current	).to.be.true;
	expect( metastate.present	).to.be.true;
	expect( metastate.writing	).to.be.false;

	const data			= modwc.state[ path ];

	expect( data.id			).to.equal( 123456789 );
	expect( data.message		).to.equal("Updated!");
    });

    it("should get all posts", async function () {
	const id			= new_id();
	database[ id ]			= {
	    id,
	    "message": "New post record",
	};

	await modwc.read("all/posts");

	const path			= `post/${id}`;
	const metastate			= modwc.metastate[ path ];

	expect( metastate.present	).to.be.true;
    });

    it("should check validity", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= modwc.metastate[ path ];

	database[ id ]			= {
	    id,
	    "message": "Valid record from origin",
	};

	expect( metastate.valid		).to.be.false;
	expect( metastate.invalid	).to.be.true;

	const mutable			= modwc.mutable[ path ];

	expect( metastate.valid		).to.be.true;
	expect( metastate.invalid	).to.be.false;

	expect( metastate.present	).to.be.false;

	await modwc.read( path );

	expect( metastate.present	).to.be.true;
	expect( metastate.valid		).to.be.true;
	expect( metastate.invalid	).to.be.false;

	delete mutable.message;

	expect( metastate.valid		).to.be.false;
	expect( metastate.invalid	).to.be.true;

	const errors			= modwc.errors[ path ];

	expect( errors			).to.have.length( 1 );
	expect( errors[0]		).to.have.string("'message' is required");

	mutable.metadata		= {
	    "foo": "bar",
	};

	await modwc.validation( path );

	expect( errors			).to.have.length( 2 );
	expect( errors[1]		).to.have.string("metadata issue");
    });

    it("should discard outdated async validation", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= modwc.metastate[ path ];
	const mutable			= modwc.mutable[ path ];

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

	await modwc.validation( path );

	expect( metastate.valid		).to.be.false;
    });

    it("should have merge conflict", async function () {
	const id			= new_id();
	const path			= `post/${id}`;
	const metastate			= modwc.metastate[ path ];

	database[ id ]			= {
	    id,
	    "message": "Valid record from origin",
	};

	const mutable			= modwc.mutable[ path ];

	mutable.message			= "force merge conflict";

	expect( metastate.changed	).to.be.true;

	let failed			= false;
	try {
	    await modwc.read( path );
	} catch (err) {
	    failed			= true;

	    expect( err.message		).to.have.string("merge conflict");
	}

	expect( failed			).to.be.true;
    });

}

describe("Unit", () => {
    describe("ModWC", basic_tests );
});
