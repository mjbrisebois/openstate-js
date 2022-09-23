'use strict'

const { Logger }			= require('@whi/weblogger');
const log				= new Logger("metastate", "fatal");

const { walk, ...objwalk }		= require('@whi/object-walk');


function serialize ( value, indent, ordered = true ) {
    let keys				= [];

    walk( value, function (k,v,path) {
	if ( typeof k === "string" && ordered === true )
	    keys.push( k );
	return v;
    });

    if ( ordered === true )
	keys.sort();

    return JSON.stringify( value, keys, indent );
}

function makeDeepClone ( target ) {
    const target_json			= serialize( target );
    const clone				= JSON.parse( target_json );
    const clone_json			= serialize( clone );

    return {
	target_json,
	clone,
	clone_json,
    };
}

function isSerializable ( target ) {
    if ( target === undefined )
	return false;
    else if ( target === null || ["string", "number", "boolean"].includes( typeof target ) )
	return true;
    else if ( !["Object", "Array"].includes( target.constructor.name ) )
	return false;

    for ( let key in target ) {
	// TODO: prevent circular loops
	if ( !isSerializable( target[ key ] ) )
	    return false;
    }

    const { target_json,
	    clone_json }		= makeDeepClone( target );

    // console.log("Checking serialization of target:", target, target_json, clone_json );

    return target_json === clone_json;
}

function clone ( target ) {
    const { target_json,
	    clone_json,
	    clone }			= makeDeepClone( target );

    if ( target_json !== clone_json )
	throw new Error(`Object contains values that are not serializable using JSON:\n    ${target_json}\n    ${clone_json}`);

    // return structuredClone( obj );
    return clone;
}

function deepFreeze(object) {
    // Retrieve the property names defined on object
    const propNames			= Object.getOwnPropertyNames(object);

    // Freeze properties before freezing self
    for ( const name of propNames ) {
	const value			= object[ name ];

	if ( value && typeof value === "object" && !ArrayBuffer.isView( value ) ) {
	    deepFreeze( value );
	}
    }

    return Object.freeze( object );
}


const SPECIAL_OBJECT_KEYS		= [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "toJSON",
];

function isSpecialProp ( prop ) {
    if ( typeof prop !== "string" || prop.startsWith("_") || SPECIAL_OBJECT_KEYS.includes( prop ) )
	return true;

    // Handle this special case that makes logging this object confusingbecause internal/util/inspect
    // does a special get on key '0' for proxy objects.
    //
    //   - https://github.com/nodejs/node/blob/f0cf1005a328b956ab4293096dd7fe9fb3c45cc6/lib/internal/util/inspect.js#L767
    //
    if ( prop === "0" && (new Error().stack).includes("util/inspect") )
	return true;

    return false;
}

const MetastateProperties		= {
    // contextual / calculated
    "present":		false,
    "current":		false,
    "changed":		false,
    "readable":		true,
    "writable":		true,

    // verbs
    "reading":		false,
    "writing":		false,

    // optimizations
    "cached":		false, // stashed
    "expired":		false,

    // validity
    "valid":		false, // correct
    "invalid":		true,
};
const computed_states			= [
    "current",
];

function checkChange ( modwc, path, benchmark ) {
    const current			= serialize( modwc.mutable[ path ] );

    // console.log("Comparing before/after states:\n      current: %s\n    benchmark: %s", current, benchmark );
    modwc.metastate[ path ].changed	= current !== benchmark;
}

function checkValidity ( modwc, path, data ) {
    // console.log("Validating path '%s':", path, data )
    const handler			= modwc.getPathHandler( path );
    const errors			= modwc.errors[ path ];

    errors.length			= 0;

    try {
	handler.validate( data, errors );
    } catch (err) {
	console.error("Failed during validation of '%s'", path, err );
	throw err;
    }
}

function onchange ( target, path, modwc, callback, target_benchmark ) {
    if ( !isSerializable( target ) )
	throw new TypeError(`Cannot deep watch target because it has incompatible properties`);

    if ( target_benchmark === undefined )
	target_benchmark		= serialize( target );

    for ( let key in target ) {
	const value			= target[ key ];

	if ( typeof value === "object" && value !== null )
	    target[ key ]		= onchange( value, path, modwc, callback, target_benchmark );
    }

    return new Proxy( target, {
	set ( target, prop, value, receiver ) {
	    if ( !isSerializable( value ) )
		throw new TypeError(`Cannot set '${prop}' to type '${value.constructor.name}'; Mutable values must be compatible with JSON serialization`);

	    if ( typeof value === "object" && value !== null )
		value			= onchange( value, path, modwc, callback, target_benchmark );

	    // console.log("Change (set) detected for '%s' on target:", prop, target );
	    try {
		return Reflect.set( target, prop, value, receiver );
	    } finally {
		callback({ target_benchmark, target, modwc, path });
	    }
	},
	deleteProperty ( target, prop, receiver ) {
	    // console.log("Change (delete) detected for '%s' on target:", prop, target );

	    try {
		return Reflect.deleteProperty(...arguments);
	    } finally {
		callback({ target_benchmark, target, modwc, path });
	    }
	},
    });
}

const METASTATE_PROP_CONTROLLER		= {
    set ( target, prop, value, receiver ) {
	target[ prop ]			= value;

	if ( ["present", "expired"].includes( prop ) )
	    receiver.current		= receiver.present && !receiver.expired;

	return Reflect.set(...arguments);
    },
};


function MetastateDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path, receiver ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const handler		= modwc.getPathHandler( path );
		receiver[ path ]	= new Proxy( Object.assign( {}, MetastateProperties ), METASTATE_PROP_CONTROLLER );

		if ( handler.readonly )
		    receiver[ path ].writable	= false;
	    }

	    return Reflect.get(...arguments);
	},
    });
}

function MutableDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path, receiver ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const handler			= modwc.getPathHandler( path );
		const metastate			= modwc.metastate[ path ];

		if ( metastate.writable === false )
		    throw new Error(`Cannot create a mutable version of ${path} because it is not writable`);

		const mutable			= handler.toMutable( modwc.state[ path ] || handler.defaultValue() );

		checkValidity( modwc, path, clone(mutable) );

		receiver[ path ]		= onchange( mutable, path, modwc, ({ target_benchmark }) => {
		    checkChange( modwc, path, target_benchmark );
		    checkValidity( modwc, path, clone(mutable) );
		});
	    }

	    return Reflect.get(...arguments);
	},
    });
}

function ErrorsDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path, receiver ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const errors			= [];
		receiver[ path ]		= onchange( errors, path, modwc, () => {
		    const valid				= errors.length === 0;
		    modwc.metastate[ path ].valid	= valid;
		    modwc.metastate[ path ].invalid	= !valid;
		});
	    }

	    return Reflect.get(...arguments);
	},
    });
}

function StateDB ( db, modwc ) {
    return new Proxy( db, {
	set ( target, path, value, receiver ) {
	    const handler		= modwc.getPathHandler( path );

	    if ( !value.__adapted__ ) {
		handler.adapt( value );
		Object.defineProperty( value, "__adapted__", { value: true });
	    }

	    if ( modwc.strict )
		deepFreeze( value );

	    target[ path ]		= value;

	    const metastate		= modwc.metastate[path];

	    metastate.present		= true;

	    if ( handler.readonly )
		metastate.writable	= false;

	    handler.readable( value ).then( readable => {
		if ( readable === undefined )
		    return;
		metastate.readable	= !!readable;
	    }).catch(err => console.error(err));

	    handler.writable( value ).then( writable => {
		if ( writable === undefined )
		    return;
		metastate.writable	= !!writable;
	    }).catch(err => console.error(err));

	    return Reflect.set(...arguments);
	},
    });
}


class Handler {
    constructor ( name, config, modwc ) {
	this.name			= name;
	this.path			= config.path.replace(/^\//, "");
	this.config			= config;
	this.regex_template		= this.path.replace(/(:[a-zA-Z_]+[^/])/g, "%" );
	this.regex			= new RegExp( "^\/?" + this.path.replace(/(:[a-zA-Z_]+[^/])/g, (x,g) => `(?<${g.slice(1)}>[^/]+)` ) + "$", "i" );
	this.__async_validation_p	= Promise.resolve();
	this.readonly			= config.readonly || false;

	this.read			= config.read.bind( modwc );

	if ( this.readonly )
	    return;

	this.create			= config.create.bind( modwc );
	this.update			= config.update.bind( modwc );

	this.context			= modwc;
    }

    async readable ( value ) {
	if ( !this.config.permissions )
	    return true;

	if ( !this.config.permissions.readable )
	    return true;

	return await this.config.permissions.readable.call( this.context, value );
    }

    async writable ( value ) {
	if ( !this.config.permissions )
	    return;

	if ( !this.config.permissions.writable )
	    return;

	return await this.config.permissions.writable.call( this.context, value );
    }

    defaultValue () {
	return this.config.defaultValue
	    ? this.config.defaultValue()
	    : {};
    }

    toMutable ( origin ) {
	let mutable;

	if ( this.config.toMutable ) {
	    mutable			= this.config.toMutable( origin );
	} else {
	    mutable			= origin;
	}

	return clone( mutable );
    }

    createInput ( input ) {
	if ( this.config.prepInput )
	    return this.config.prepInput( input ) || input;

	return input;
    }

    isMatch ( path ) {
	return this.regex.exec( path );
    }

    parsePath ( path ) {
	return this.regex.exec( path ).groups;
    }

    adapt ( data ) {
	if ( this.config.adapter )
	    this.config.adapter( data );
    }

    validate ( data, errors ) {
	if ( this.config.validation ) {
	    const sync_errors		= [];
	    this.config.validation( data, sync_errors );

	    log.debug("Adding %s sync errors", sync_errors.length );
	    errors.splice( 0, errors.length, ...sync_errors );
	}

	if ( this.config.asyncValidation ) {
	    const async_errors		= [];
	    const async_promise		= this.config.asyncValidation( data, async_errors )
		.catch(err => console.error(err));

	    async_promise.then(() => {
		if ( this.__async_validation_p !== async_promise ) {
		    log.warn("Discarding %s outdated async errors", async_errors.length );
		    return; // discard errors because a new validation has replaced this one
		}

		log.debug("Adding %s async errors", async_errors.length );
		errors.splice( errors.length, 0, ...async_errors );
	    });

	    this.__async_validation_p	= async_promise;
	}
    }

    toString () {
	return `[${this.name} @ ${this.regex_template}]`;
    }
}


class ModWC {
    constructor ({ reactive, strict = true } = {}, handlers ) {
	this._handlers			= [];
	this.strict			= !!strict;

	if ( handlers )
	    this.addHandlers( handlers );

	if ( reactive ) {
	    this.metastate		= reactive( MetastateDB( {}, this ) );
	    this.state			= reactive( StateDB( {}, this ) );
	    this.mutable		= reactive( MutableDB( {}, this ) );
	    this.errors			= reactive( ErrorsDB( {}, this ) );
	} else {
	    this.metastate		= MetastateDB( {}, this );
	    this.state			= StateDB( {}, this );
	    this.mutable		= MutableDB( {}, this );
	    this.errors			= ErrorsDB( {}, this );
	}
    }

    addHandlers ( handlers ) {
	for ( let name in handlers ) {
	    const config		= handlers[ name ];
	    const handler		= new Handler( name, config, this );

	    this._handlers.forEach( h => {
		if ( h.regex_template === handler.regex_template )
		    throw new Error(`Cannot add handler ${handler}; path already reserved by ${h}`);
	    });

	    this._handlers.push( handler );
	}
    }

    getPathHandler ( path ) {
	// console.log("getPathHandler( %s )", path );
	const handler		= this._handlers.find( handler => handler.isMatch( path ) );

	if ( !handler )
	    throw new Error(`No handler for path: ${path}`);

	return handler;
    }

    validation ( path ) {
	const handler			= this.getPathHandler( path );
	return handler.__async_validation_p;
    }

    async get ( path ) {
	return this.state[ path ]
	    ? this.state[path]
	    : await this.read( path );
    }

    async read ( path ) {
	const metastate			= this.metastate[ path ];
	const handler			= this.getPathHandler( path );

	metastate.reading		= true;

	const result			= await handler.read( handler.parsePath( path ), path );

	metastate.reading		= false;

	if ( !result )
	    throw new Error(`Read returned not found: ${result}`);

	this.state[ path ]		= result;

	if ( metastate.changed !== false )
	    throw new Error(`Mutable merge conflict for path '${path}'; state is updated, but mutable does not resemble the new state`);

	metastate.writable && this.mutable[ path ]; // force mutable creation

	return this.state[ path ];
    }

    async write ( path ) {
	const metastate			= this.metastate[ path ];
	const mutable			= this.mutable[ path ];
	const handler			= this.getPathHandler( path );

	if ( handler.create === undefined )
	    throw new TypeError(`a create() method has not been defined for path type ${handler.name}`);
	if ( handler.update === undefined )
	    throw new TypeError(`an update() method has not been defined for path type ${handler.name}`);

	const input			= handler.createInput( clone( mutable ) );

	metastate.writing		= true;

	const result			= await (
	    metastate.present
		? handler.update( handler.parsePath( path ), input, this.state[ path ] )
		: handler.create( input )
	);

	metastate.writing		= false;

	delete this.mutable[ path ];

	if ( result )
	    this.state[ path ]		= result;
	else
	    this.read( path );
    }
}


function createModWC( ...args ) {
    return new ModWC( ...args );
}


module.exports = {
    ModWC,
    createModWC,
    logging ( level = "trace" ) {
	console.log("Setting log level to '%s' for Logger: %s", level, log.context );
	log.setLevel( level );
    }
};
