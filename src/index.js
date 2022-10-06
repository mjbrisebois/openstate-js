'use strict'

const { Logger }			= require('@whi/weblogger');
const log				= new Logger("modwc");

const { walk, ...objwalk }		= require('@whi/object-walk');

const DEADEND				= Symbol(); // inactive, dormant, idle, passive, lifeless, uninhabited, static, nothing, none, nil


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
    else if ( typeof target.toJSON === "function" )
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
    "failed":		false,
};
const computed_states			= [
    "current",
];

function checkChange ( modwc, path, benchmark ) {
    const metastate			= modwc.metastate[ path ];
    const current			= serialize( modwc.mutable[ path ] );

    // console.log("Comparing before/after states:\n      current: %s\n    benchmark: %s", current, benchmark );
    metastate.changed		= current !== benchmark;
}

function checkValidity ( modwc, path, data ) {
    // console.log("Validating path '%s':", path, data )
    const handler			= modwc.getPathHandler( path );
    const errors			= modwc.errors[ path ];

    errors.length			= 0;

    try {
	handler.validate( path, data, errors );
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
	set ( target, prop, value ) {
	    if ( !isSerializable( value ) )
		throw new TypeError(`Cannot set '${prop}' to type '${value.constructor.name}'; Mutable values must be compatible with JSON serialization`);

	    value			= clone( value );

	    if ( typeof value === "object" && value !== null )
		value			= onchange( value, path, modwc, callback, target_benchmark );

	    // console.log("Change (set) detected for '%s' on target:", prop, target );
	    try {
		return Reflect.set( target, prop, value );
	    } finally {
		callback({ target_benchmark, target, modwc, path });
	    }
	},
	deleteProperty ( target, prop ) {
	    // console.log("Change (delete) detected for '%s' on target:", prop, target );

	    try {
		return Reflect.deleteProperty(...arguments);
	    } finally {
		callback({ target_benchmark, target, modwc, path });
	    }
	},
    });
}



function MetastateDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const handler		= modwc.getPathHandler( path );
		target[ path ]		= new Proxy( Object.assign( {}, MetastateProperties ), {
		    set ( target, prop, value ) {
			if ( value === target[ prop ] )
			    return true;

			target[ prop ]			= value;

			if ( ["present", "expired"].includes( prop ) )
			    target.current		= target.present && !target.expired;

			modwc.emit( path, "metastate", prop, value );

			return true;
		    },
		});

		if ( handler.readonly )
		    target[ path ].writable	= false;
	    }

	    return Reflect.get(...arguments);
	},
    });
}

function MutableDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const handler			= modwc.getPathHandler( path );
		const metastate			= modwc.metastate[ path ];

		if ( metastate.writable === false )
		    throw new Error(`Cannot create a mutable version of ${path} because it is not writable`);

		const state			= modwc.state[ path ];

		log.level.debug && !state && log.info("No state for path '%s'; must use default value", path );
		const mutable			= state
		      ? handler.toMutable( state )
		      : handler.defaultMutable( path );

		if ( state === undefined )
		    modwc.metastate[ path ].changed	= true;

		checkValidity( modwc, path, clone(mutable) );

		target[ path ]			= onchange( mutable, path, modwc, ({ target_benchmark }) => {
		    if ( state !== undefined )
			checkChange( modwc, path, target_benchmark );

		    checkValidity( modwc, path, clone(mutable) );
		    modwc.emit( path, "mutable" );
		});
	    }

	    return Reflect.get(...arguments);
	},
	deleteProperty ( target, path ) {
	    const metastate			= modwc.metastate[ path ];
	    metastate.changed			= false;

	    return Reflect.deleteProperty(...arguments);
	},
    });
}

function ErrorsDB ( db, modwc ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const errors			= [];
		target[ path ]			= onchange( errors, path, modwc, () => {
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
	set ( target, path, value ) {
	    const handler		= modwc.getPathHandler( path );

	    if ( !value.__adapted__ ) {
		handler.adapt( value );
		Object.defineProperty( value, "__adapted__", { value: true });
	    }

	    if ( modwc.strict )
		deepFreeze( value );

	    target[ path ]		= value;

	    const metastate		= modwc.metastate[ path ];

	    metastate.present		= true;

	    if ( handler.readonly )
		metastate.writable	= false;

	    handler.readable( value, path ).then( readable => {
		if ( readable === undefined )
		    return;
		metastate.readable	= !!readable;
	    }).catch(err => console.error(err));

	    handler.writable( value, path ).then( writable => {
		if ( writable === undefined )
		    return;
		metastate.writable	= !!writable;
	    }).catch(err => console.error(err));

	    modwc.emit( path, "state" );

	    return true;
	},
    });
}


class Handler {
    constructor ( name, config, modwc ) {
	this.name			= name;
	this.config			= config;
	this.context			= modwc;

	this.path			= config.path.replace(/^\//, "");
	this.regex_template		= this.path.replace(/(:[a-zA-Z_]+[^/])/g, "%" );
	this.regex			= new RegExp( "^\/?" + this.path.replace(/(:[a-zA-Z_]+[^/])/g, (x,g) => `(?<${g.slice(1)}>[^/]+)` ) + "$", "i" );
	this.__async_validation_p	= Promise.resolve();
	this.readonly			= config.readonly || false;

	this.read			= config.read.bind( modwc );

	if ( this.readonly )
	    return;

	this.create			= config.create.bind( modwc );
	this.update			= config.update.bind( modwc );
    }

    async readable ( value ) {
	if ( !this.config.permissions )
	    return true;

	if ( !this.config.permissions.readable )
	    return true;

	return await this.config.permissions.readable.call( this.context, value );
    }

    async writable ( value, path ) {
	if ( !this.config.permissions )
	    return;

	if ( !this.config.permissions.writable )
	    return;

	return await this.config.permissions.writable.call( this.context, value );
    }

    defaultMutable ( path ) {
	if ( !this.config.defaultMutable )
	    throw new Error(`No default value for handler ${this}`);

	return this.config.defaultMutable( path );
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

    validate ( path, data, errors ) {
	const metastate			= this.context.metastate[ path ];
	const type			= metastate.present ? "update" : "create";

	if ( this.config.validation ) {
	    const sync_errors		= [];
	    this.config.validation( data, sync_errors, type );

	    log.debug("Adding %s sync errors", sync_errors.length );
	    errors.splice( 0, errors.length, ...sync_errors );
	}

	if ( this.config.asyncValidation ) {
	    const async_errors		= [];
	    const async_promise		= this.config.asyncValidation( data, async_errors, type )
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
    static DEADEND			= DEADEND;

    constructor ({ reactive, strict = true } = {}, handlers ) {
	this._handlers			= [];
	this._readings			= {};
	this.strict			= !!strict;
	this.DEADEND			= DEADEND;

	if ( handlers )
	    this.addHandlers( handlers );

	Object.defineProperties( this, {
	    "__metastate": {
		"value": {
		    [DEADEND]: {
			"present":	false,
			"current":	false,
			"changed":	false,
			"readable":	false,
			"writable":	false,

			"reading":	false,
			"writing":	false,

			"cached":	false,
			"expired":	false,

			"valid":	false,
			"invalid":	true,
		    },
		},
	    },
	    "__state": {
		"value": {
		    [DEADEND]: null,
		},
	    },
	    "__mutable": {
		"value": {
		    [DEADEND]: Object.freeze({}),
		},
	    },
	    "__errors": {
		"value": {
		    [DEADEND]: [],
		},
	    },
	    "__listeners": {
		"value": {},
	    },
	});

	if ( reactive ) {
	    this.metastate		= reactive( MetastateDB( this.__metastate, this ) );
	    this.state			= reactive( StateDB( this.__state, this ) );
	    this.mutable		= reactive( MutableDB( this.__mutable, this ) );
	    this.errors			= reactive( ErrorsDB( this.__errors, this ) );
	} else {
	    this.metastate		= MetastateDB( this.__metastate, this );
	    this.state			= StateDB( this.__state, this );
	    this.mutable		= MutableDB( this.__mutable, this );
	    this.errors			= ErrorsDB( this.__errors, this );
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

    on ( path, callback ) {
	if ( typeof callback !== "function" )
	    throw new TypeError(`Event callback for path '${path}' must be a function; not type '${typeof callback}'`);

	if ( this.__listeners[ path ] === undefined )
	    this.__listeners[ path ]	= [];

	this.__listeners[ path ].push( callback );
    }

    emit ( path, event_name, ...args ) {
	// TODO: Should implement a global emitter that supports pattern regex matching for paths

	if ( this.__listeners[ path ] === undefined )
	    return;

	this.__listeners[ path ].forEach( callback => {
	    try {
		callback( event_name, ...args );
	    } catch ( err ) {
		console.error( err );
	    }
	});
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

    purge ( path ) {
	delete this.metastate[ path ];
	delete this.state[ path ];
	delete this.mutable[ path ];
	delete this.errors[ path ];
	delete this.__listeners[ path ];
    }

    resetMutable ( path ) {
	delete this.mutable[ path ];

	this.metastate[ path ].failed	= false;

	return this.mutable[ path ];
    }

    async get ( path ) {
	return this.state[ path ]
	    ? this.state[path]
	    : await this.read( path );
    }

    async read ( path ) {
	const metastate			= this.metastate[ path ];
	const handler			= this.getPathHandler( path );

	if ( metastate.reading ) {
	    log.debug("Duplicate read request for '%s'", path );
	    return await this._readings[ path ];
	}

	metastate.reading		= true;
	this._readings[ path ]		= handler.read( handler.parsePath( path ), path );

	const result			= await this._readings[ path ];

	metastate.reading		= false;
	delete this._readings[ path ];

	if ( !result )
	    throw new Error(`Read returned not found: ${result}`);

	if ( this.state[ path ] )
	    log.info("Result from read of path '%s' will replace current state", path );

	log.trace("Saving read result for '%s':", path, result );
	this.state[ path ]		= result;

	if ( metastate.changed !== false ) {
	    log.warn("New state's mutable value cannot be merged with the current mutable.");
	    throw new Error(`Mutable merge conflict for path '${path}'; state is updated, but mutable does not resemble the new state`);
	}

	metastate.writable && this.mutable[ path ]; // force mutable creation

	log.trace("Return read result for '%s':", path, this.state[ path ] );
	return this.state[ path ];
    }

    async write ( path ) {
	log.info("Writing path '%s'", path );
	const metastate			= this.metastate[ path ];
	const mutable			= this.mutable[ path ];
	const handler			= this.getPathHandler( path );

	if ( handler.create === undefined )
	    throw new TypeError(`a create() method has not been defined for path type ${handler.name}`);
	if ( handler.update === undefined )
	    throw new TypeError(`an update() method has not been defined for path type ${handler.name}`);

	if ( metastate.invalid ) {
	    metastate.failed		= true;

	    const errors		= this.errors[ path ];
	    throw new Error(`Validation error: ${errors}`);
	}

	const input			= handler.createInput( clone( mutable ) );

	metastate.writing		= true;

	log.debug("Final write input for '%s':", path, input );
	const result			= await (
	    metastate.present
		? handler.update( handler.parsePath( path ), input, this.state[ path ] )
		: handler.create( input )
	);

	if ( result === undefined )
	    log.info("%s for path '%s' returned undefined", metastate.present ? "Update" : "Create", path );

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
    DEADEND,
    logging ( level = "trace" ) {
	console.log("Setting log level to '%s' for Logger: %s", level, log.context );
	log.setLevel( level );
    }
};
