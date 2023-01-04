'use strict'

const { Logger }			= require('@whi/weblogger');
const log				= new Logger("openstate");

const deepEqual				= require('deep-equal');
const deepClone				= require('clone-deep');
const repr				= require('@whi/repr');

const DEADEND				= Symbol(); // inactive, dormant, idle, passive, lifeless, uninhabited, static, nothing, none, nil


function verifySerializable ( target ) {
    if ( target === undefined )
	throw new TypeError(`'undefined' cannot be serialized`);
    else if ( target === null || ["string", "number", "boolean"].includes( typeof target ) )
	return;
    else if ( ["Object", "Array"].includes( target.constructor.name ) ) {
	for ( let key in target ) {
	    // TODO: prevent circular loops
	    verifySerializable( target[ key ] )
	}
	return;
    }
    else if ( ArrayBuffer.isView( target ) )
	return;
    else
	throw new TypeError(`Unknown type '${repr(target)}' may not be serializable`);
}

function isSerializable ( target ) {
    try {
	verifySerializable( target );
    } catch (err) {
	console.error("Serialization check failure:", err );
	return false;
    }
    return true;
}

function clone ( target ) {
    log.debug("Cloning target:", target );
    const cloned			= deepClone( target );
    log.debug("Finished cloning target:", target, cloned );
    return cloned;
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

function checkChange ( openstate, path, benchmark ) {
    const metastate			= openstate.metastate[ path ];

    const before			= benchmark;
    const after				= openstate.mutable[ path ];
    const all_keys			= new Set([ ...Object.keys(before), ...Object.keys(after) ]);
    const changed			= {};

    for ( let k of all_keys ) {
	if ( before[k] === undefined || after[k] === undefined ) // new prop or deleted prop
	    changed[ k ]		= [ before[k], after[k] ];
	else if ( typeof before[k] === "object" && before[k] !== null ) { // complex object
	    if ( typeof after[k] !== "object" || !deepEqual( before[k], after[k] ) ) // different type or value
		changed[ k ]		= [ before[k], after[k] ];
	}
	else if ( typeof before[k] !== typeof after[k] || before[k] !== after[k] ) // is changed
	    changed[ k ]		= [ before[k], after[k] ];
    }

    openstate.__changed[ path ]		= changed;

    metastate.changed			= Object.keys(changed).length > 0;
}

function checkValidity ( openstate, path ) {
    // console.log("Validating path '%s':", path, data )
    const handler			= openstate.getPathHandler( path );

    try {
	handler.validate( path );
    } catch (err) {
	console.error("Failed during validation of '%s'", path, err );
	throw err;
    }
}

function onchange ( watched_target, path, openstate, callback, target_benchmark ) {
    if ( target_benchmark === undefined )
	target_benchmark		= clone( watched_target );

    return new Proxy( watched_target, {
	get ( target, prop ) {
	    const value			= target[ prop ];

	    if ( value instanceof ArrayBuffer || ArrayBuffer.isView(value) )
		return value;

	    if ( typeof value === "object" && value !== null )
		return onchange( value, path, openstate, callback, target_benchmark );

	    return value;
	},
	set ( target, prop, value ) {
	    if ( !isSerializable( value ) )
		throw new TypeError(`Cannot set '${prop}' to type '${value.constructor.name}'; Mutable values must be serializable`);

	    try {
		return Reflect.set( target, prop, value );
	    } finally {
		callback({ target_benchmark, target, openstate, path });
	    }
	},
	deleteProperty ( target, prop ) {
	    // console.log("Change (delete) detected for '%s' on target:", prop, target );
	    try {
		return Reflect.deleteProperty(...arguments);
	    } finally {
		callback({ target_benchmark, target, openstate, path });
	    }
	},
    });
}



function MetastateDB ( db, openstate ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const handler		= openstate.getPathHandler( path );
		target[ path ]		= new Proxy( Object.assign( {}, MetastateProperties ), {
		    set ( target, prop, value ) {
			if ( value === target[ prop ] )
			    return true;

			target[ prop ]		= value;

			if ( ["present", "expired"].includes( prop ) )
			    target.current	= target.present && !target.expired;

			openstate.emit( path, "metastate", prop, value );

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

function MutableDB ( db, openstate ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    const state				= openstate.state[ path ];

	    if ( target[ path ] === undefined ) {
		const handler			= openstate.getPathHandler( path );
		const metastate			= openstate.metastate[ path ];

		if ( metastate.writable === false )
		    throw new Error(`Cannot create a mutable version of ${path} because it is not writable`);

		let mutable;
		if ( state ) {
		    log.info("Deriving mutable from state for '%s'", path );
		    mutable			= handler.toMutable( state );
		} else {
		    log.info("No state for path '%s'; using default mutable", path );
		    mutable			= handler.defaultMutable( path );
		}

		if ( !isSerializable( mutable ) )
		    throw new TypeError(`New mutable for '${path}' has properties that cannot be serialized`);

		if ( state === undefined )
		    openstate.metastate[ path ].changed	= true;

		// save original state for change benchmarks
		openstate.__change_benchmarks[ path ] = clone( mutable );

		target[ path ]			= openstate.addReactivityWrappers( mutable );

		log.debug("Check validity of new mutable: %s", path );
		checkValidity( openstate, path );
	    }

	    const target_benchmark		= openstate.__change_benchmarks[ path ];

	    return onchange( target[ path ], path, openstate, ({ target_benchmark }) => {
		if ( state !== undefined )
		    checkChange( openstate, path, target_benchmark );

		checkValidity( openstate, path );
		openstate.emit( path, "mutable" );
	    }, target_benchmark );
	},
	deleteProperty ( target, path ) {
	    const metastate			= openstate.metastate[ path ];

	    delete openstate.__change_benchmarks[ path ];
	    openstate.__changed[ path ]		= [];
	    metastate.changed			= false;

	    return Reflect.deleteProperty(...arguments);
	},
    });
}

function RejectionsDB ( db, openstate ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined ) {
		const rejections		= [];
		target[ path ]			= onchange( rejections, path, openstate, () => {
		    const valid				= rejections.length === 0;
		    openstate.metastate[ path ].valid	= valid;
		    openstate.metastate[ path ].invalid	= !valid;
		});
	    }

	    return Reflect.get(...arguments);
	},
	set () {
	    throw new Error(`Do not manually set error lists`);
	},
    });
}

function ErrorsDB ( db, openstate ) {
    return new Proxy( db, {
	get ( target, path ) {
	    if ( isSpecialProp( path ) )
		return Reflect.get(...arguments);

	    if ( target[ path ] === undefined )
		target[ path ]			= { "read": null, "write": null };

	    return Reflect.get(...arguments);
	},
	set () {
	    throw new Error(`Do not manually set error context`);
	},
    });
}

function StateDB ( db, openstate ) {
    return new Proxy( db, {
	set ( target, path, value ) {
	    const handler		= openstate.getPathHandler( path );

	    if ( typeof value === "object" && value !== null
		 && !value.__adapted__ && Object.isExtensible( value ) ) {
		handler.adapt( value );
		Object.defineProperty( value, "__adapted__", { value: true });
	    }

	    if ( openstate.strict ) {
		try {
		    deepFreeze( value );
		} catch (err) {
		    if ( err.message.includes("Cannot freeze array buffer views with elements") )
			log.warn("Allowing unfreezable state value for: %s", path );
		}
	    }

	    target[ path ]		= value;

	    const metastate		= openstate.metastate[ path ];

	    metastate.present		= true;
	    metastate.expired		= false;

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

	    openstate.emit( path, "state" );

	    return true;
	},
    });
}


class Handler {
    constructor ( name, config, openstate ) {
	this.name			= name;
	this.config			= config;
	this.context			= openstate;

	this.path			= config.path.replace(/^\//, "");
	this.regex_template		= this.path.replace(/(:[a-zA-Z_]+[^/])/g, "%" );
	this.regex			= new RegExp( "^\/?" + this.path.replace(/(:[a-zA-Z_]+[^/])/g, (x,g) => `(?<${g.slice(1)}>[^/]+)` ) + "$", "i" );
	this.__async_validation_p	= Promise.resolve();
	this.readonly			= config.readonly || false;

	this._read			= config.read;

	if ( this.readonly )
	    return;

	this._create			= config.create;
	this._update			= config.update;
	this._delete			= config.delete;
    }

    scoped_this_arg ( path ) {
	const openstate			= this.context;
	return {
	    openstate,
	    "handler":		this,
	    "params":		this.parsePath( path ),
	    get state () {
		return openstate.state[ path ];
	    },
	    get metastate () {
		return openstate.metastate[ path ];
	    },
	    get mutable () {
		return openstate.mutable[ path ];
	    },
	};
    }

    async read ( path, opts ) {
	return await this._read.call(
	    this.scoped_this_arg( path ),
	    this.parsePath( path ), opts
	);
    }

    async create ( path, input, intent ) {
	if ( this._create === undefined )
	    throw new TypeError(`a create() method has not been defined for path type ${this.name}`);

	return await this._create.call(
	    this.scoped_this_arg( path ),
	    input, intent
	);
    }

    async update ( path, changed, intent ) {
	if ( this._update === undefined )
	    throw new TypeError(`an update() method has not been defined for path type ${this.name}`);

	return await this._update.call(
	    this.scoped_this_arg( path ),
	    this.parsePath( path ), changed, intent
	);
    }

    async delete ( path, intent ) {
	if ( this._delete === undefined )
	    throw new TypeError(`a delete() method has not been defined for path type ${this.name}`);

	return await this._delete.call(
	    this.scoped_this_arg( path ),
	    this.parsePath( path ), intent
	);
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

    defaultMutable ( path ) {
	if ( !this.config.defaultMutable )
	    return {};
	//     throw new Error(`No default value for handler ${this}`);

	return this.config.defaultMutable( path );
    }

    toMutable ( state ) {
	let mutable			= state;

	if ( this.context.globalDefaults.toMutable )
	    mutable			= this.context.globalDefaults.toMutable( mutable ) || mutable;

	if ( this.config.toMutable )
	    mutable			= this.config.toMutable( mutable ) || mutable;

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
	if ( this.context.globalDefaults.adapter )
	    this.context.globalDefaults.adapter( data );

	if ( this.config.adapter )
	    this.config.adapter( data );
    }

    async validate ( path, intent ) {
	const openstate			= this.context;
	const metastate			= openstate.metastate[ path ];

	openstate.mutable[ path ]; // make sure it exists
	const mutable			= openstate.__mutable[ path ];
	const rejections		= openstate.rejections[ path ];

	rejections.length		= 0;

	const type			= intent || ( metastate.present ? "update" : "create" );

	if ( this.config.validation ) {
	    const added_rejections	= [];
	    const async_p		= this.config.validation( mutable, added_rejections, type );
	    this.__async_validation_p	= async_p;

	    log.debug("Adding %s sync rejections for %s", added_rejections.length, path );
	    rejections.splice( 0, 0, ...added_rejections );

	    added_rejections.length	= 0;

	    await async_p;

	    if ( this.__async_validation_p !== async_p ) {
		log.warn("Discarding %s outdated async errors", added_rejections.length );
		return; // discard errors because a new validation has replaced this one
	    }

	    log.debug("Adding %s async rejections for %s", added_rejections.length, path );
	    rejections.splice( rejections.length, 0, ...added_rejections );
	}

	return rejections;
    }

    toString () {
	return `[${this.name} @ ${this.regex_template}]`;
    }
}


class OpenState {
    static DEADEND			= DEADEND;

    constructor ({ reactive, strict = true, globalDefaults = {} } = {}, handlers ) {
	this.DEADEND			= DEADEND;
	this._handlers			= [];
	this._readings			= {};

	this.strict			= !!strict;
	this.globalDefaults		= globalDefaults;
	this.reactive_wrapper		= [];

	if ( reactive !== undefined ) {
	    if ( typeof reactive === "function" )
		this.reactive_wrapper.push( reactive );
	    else if ( Array.isArray( reactive ) )
		this.reactive_wrapper.push( ...reactive );
	    else
		throw new TypeError(`Unusable 'reactive' option with type: ${typeof reactive}`);
	}

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
			"failed":	false,
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
	    "__rejections": {
		"value": {
		    [DEADEND]: [],
		},
	    },
	    "__errors": {
		"value": {
		    [DEADEND]: { read: null, write: null, },
		},
	    },
	    "__listeners": {
		"value": {},
	    },
	    "__changed": {
		"value": {},
	    },
	    "__change_benchmarks": {
		"value": {},
	    },
	});

	if ( reactive ) {
	    this.metastate		= reactive( MetastateDB( this.__metastate, this ) );
	    this.state			= reactive( StateDB( this.__state, this ) );
	    this.mutable		= reactive( MutableDB( this.__mutable, this ) );
	    this.rejections		= reactive( RejectionsDB( this.__rejections, this ) );
	    this.errors			= reactive( ErrorsDB( this.__errors, this ) );
	} else {
	    this.metastate		= MetastateDB( this.__metastate, this );
	    this.state			= StateDB( this.__state, this );
	    this.mutable		= MutableDB( this.__mutable, this );
	    this.rejections		= RejectionsDB( this.__rejections, this );
	    this.errors			= ErrorsDB( this.__errors, this );
	}
    }

    addReactivityWrappers ( value ) {
	this.reactive_wrapper.forEach( reactive_wrapper => {
	    value			= reactive_wrapper( value );
	});
	return value;
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
	if ( path === DEADEND )
	    throw new Error(`No handler for DEADEND path`);

	const handler			= this._handlers.find( handler => handler.isMatch( path ) );

	if ( !handler )
	    throw new Error(`No handler for path: ${path}`);

	return handler;
    }

    validation ( path ) {
	const handler			= this.getPathHandler( path );
	return handler.__async_validation_p;
    }

    movePath ( fromPath, toPath ) {
	this.state[ toPath ]		= this.state[ fromPath ];
	this.purge( fromPath );
    }

    purge ( path ) {
	log.normal("Purge path: %s", path );
	delete this.metastate[ path ];
	delete this.state[ path ];
	delete this.mutable[ path ];
	delete this.rejections[ path ];
	delete this.__listeners[ path ];
	delete this.__changed[ path ];
    }

    resetMutable ( path ) {
	delete this.mutable[ path ];

	this.metastate[ path ].failed	= false;

	return this.mutable[ path ];
    }

    getChanged ( path ) {
	if ( this.__changed[ path ] === undefined )
	    return {};

	return Object.entries(this.__changed[ path ]).reduce( (acc, [k,[b,a]]) => {
	    acc[ k ]			= a;
	    return acc;
	}, {} );
    }

    async get ( path, opts ) {
	if ( opts )
	    log.trace("Get '%s' opts:", path, opts );
	return this.state[ path ]
	    ? this.state[path]
	    : await this.read( path, opts );
    }

    async read ( path, options = {}) {
	const opts			= Object.assign( {}, {
	    "allowMergeConflict": false,
	    "rememberState": true,
	}, options );
	const metastate			= this.metastate[ path ];
	const handler			= this.getPathHandler( path );

	if ( metastate.reading ) {
	    log.debug("Duplicate read request for '%s'", path );
	    return await this._readings[ path ];
	}

	metastate.expired		= true;
	metastate.reading		= true;

	// Allow CPU to update GUI after changing metastate.writing
	await new Promise( f => setTimeout(f, 0) );

	let result;
	try {
	    this._readings[ path ]	= handler.read( path, opts );

	    result			= await this._readings[ path ];
	} catch ( err ) {
	    this.errors[ path ].read	= err;

	    throw err;
	} finally {
	    metastate.reading		= false;
	    delete this._readings[ path ];
	}

	if ( result === undefined )
	    throw new Error(`Read returned not found '${path}': ${result}`);

	if ( this.state[ path ] )
	    log.info("Result from read of path '%s' will replace current state", path );

	if ( opts.rememberState === true ) {
	    log.trace("Saving read result for '%s' (remember state: %s):", path, opts.rememberState, result );
	    this.state[ path ]		= result;
	} else {
	    log.warn("Not saving result in state for read '%s'", path );
	    return result;
	}

	this.emit( "*", "read", path, this.state[ path ] );

	if ( metastate.changed !== false ) {
	    log.warn("New state's mutable value cannot be merged with the current mutable.");
	    if ( opts.allowMergeConflict !== true )
		throw new Error(`Mutable merge conflict for path '${path}'; state is updated, but mutable does not resemble the new state`);
	}

	metastate.writable && this.mutable[ path ]; // force mutable creation

	log.trace("Return read result for '%s':", path, this.state[ path ] );
	return this.state[ path ];
    }

    async write ( path, intent ) {
	log.info("Writing path '%s'", path );
	const state			= this.state[ path ];
	const metastate			= this.metastate[ path ];

	this.mutable[ path ]; // make sure it exists
	const mutable			= this.__mutable[ path ];
	const changed			= this.getChanged( path );
	const handler			= this.getPathHandler( path );

	metastate.writing		= true;

	// Allow CPU to update GUI after changing metastate.writing
	await new Promise( f => setTimeout(f, 0) );

	await this.validation( path );

	let result;
	try {
	    if ( Array.isArray( intent ) )
		intent			= intent.join("&");

	    const rejections		= intent === undefined
		  ? this.rejections[ path ]
		  : await handler.validate( path, intent );

	    if ( rejections.length > 0 )
		throw new Error(`Validation error: ${rejections.join('; ')}`);

	    const input			= handler.createInput( clone( mutable ) );

	    log.debug("Final write input for '%s':", path, input );

	    if ( metastate.present && Object.keys(changed).length === 0 )
		log.warn("Update for %s (%s) has no changes", path, intent );

	    result			= await (
		metastate.present
		    ? handler.update( path, changed, intent )
		    : handler.create( path, input, intent )
	    );

	    if ( result === undefined )
		log.info("%s for path '%s' returned undefined", metastate.present ? "Update" : "Create", path );

	    // We should be able to do a partial reset for mutable based on 'intent'
	    delete this.mutable[ path ];
	} catch (err) {
	    metastate.failed		= true;

	    if ( !err.message.startsWith("Validation error") ) {
		this.errors[ path ].write		= err;

		if ( intent )
		    this.errors[ path ][ intent ]	= err;
	    }

	    throw err;
	} finally {
	    metastate.writing		= false;
	}

	if ( result )
	    this.state[ path ]		= result;
	else
	    await this.read( path );

	return this.state[ path ];
    }

    async delete ( path, intent ) {
	log.info("Deleting path '%s'", path );
	const metastate			= this.metastate[ path ];
	const handler			= this.getPathHandler( path );

	metastate.writing		= true;

	// Allow CPU to update GUI after changing metastate.writing
	await new Promise( f => setTimeout(f, 0) );

	try {
	    await handler.delete( path, intent );
	    this.purge( path );
	} catch (err) {
	    this.errors[ path ].write	= err;
	    this.errors[ path ].delete	= err;

	    if ( intent )
		this.errors[ path ][ intent ]	= err;

	    throw err;
	} finally {
	    metastate.writing		= false;
	}
    }
}


function create ( ...args ) {
    return new OpenState( ...args );
}


module.exports = {
    OpenState,
    create,
    DEADEND,
    logging ( level = "trace" ) {
	console.log("Setting log level to '%s' for Logger: %s", level, log.context );
	log.setLevel( level );
    },
    deepEqual,
    deepClone,
};
