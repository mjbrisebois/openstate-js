const { OpenState,
	...expose }			=  require('./index.js');


if ( typeof window === "undefined" ) {
    const { inspect }			= require('util');

    Object.defineProperties( OpenState.prototype, {
	[inspect.custom]: {
	    value: function ( depth, options ) {
		const repr			= {
		    "metastate":	this.metastate,
		    "state":		this.state,
		    "mutable":		this.mutable,
		};
		return "OpenState " + inspect( repr, options );
	    },
	},
    });
}

module.exports = {
    OpenState,
    ...expose,
};
