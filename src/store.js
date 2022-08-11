
const INIT_METASTATE				= {
    "present":		false,
    "reading":		false,
    "writing":		false,
    "cached":		false,
    "expired":		false,
    "valid":		true,
    "invalid":		false,
    // "current":		false,
};

export default function ( Vuex, client ) {
    return Vuex.createStore({
	"state": {
	    "count": 0,
	    "entities": {},
	},
	"getters": {
	    count ( state ) {
		return state.count;
	    },
	},
	"mutations": {
	    increment ( state ) {
		state.count		       += 1;
	    },
	    metastate ( state, [ id, name, change ] ) {
		if ( state.metastate[id] === undefined )
		    state.metastate[id]		= Object.assign( {}, INIT_METASTATE );

		const ms			= state.metastate[id];

		if ( ms[name] === undefined )
		    throw new Error(`Metastate object is invalid; missing '${name}' in state object: ${typeof ms}`);

		ms[name]		= change;
	    },
	    entity ( state, { id, entity } ) {
		state.entities[id]		= entity;
	    },
	},
	"actions": {
	    async increment ({ commit }) {
		commit("increment");
	    },
	    async reading ({ commit }, id ) {
		commit("metastate", [ id, "reading", true ]);
	    },
	    async client ({ commit }, [ dna, zome, func, args ]) {
		return await client.call( dna, zome, func, args );
	    },
	    async get_something ({ dispatch, commit }, id ) {
		dispatch("reading", id );

		const entity			= await dispatch("client", [
		    "dna_name", "zome_name", "function_name", { id }
		]);

		commit("entity", { id, entity });

		return entity;
	    },
	},
    });
}
