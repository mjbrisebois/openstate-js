const { ModWC,
	...expose }			=  require('./index.js');


if ( typeof window === "undefined" ) {
    const { inspect }			= require('util');

    Object.defineProperties( ModWC.prototype, {
	[inspect.custom]: {
	    value: function ( depth, options ) {
		const repr			= {
		    "metastate":	this.metastate,
		    "state":		this.state,
		    "mutable":		this.mutable,
		};
		return "ModWC " + inspect( repr, options );
	    },
	},
    });
}

module.exports = {
    ModWC,
    ...expose,
};
