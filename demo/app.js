
import { modwc }			from './modwc_setup.js';
import { UserPost }			from './modwc_comments.js';

window.modwc				= modwc;

ModWC.logging();

console.log("Defining user-post");
customElements.define("user-post", UserPost );

const allposts				= "all/posts";

modwc.read( allposts );


const app				= Vue.createApp({
    data () {
	console.log("Init app data");
	window.$app = this;
	return {
	    "create_new": false,
	};
    },
    "computed": {
	posts () {
	    console.log( allposts, this.$modwc.state["all/posts"] )
	    return this.$modwc.state[ allposts ] || null;
	},
	$posts () {
	    return this.$modwc.metastate[ allposts ];
	},
    },
    "methods": {
	close () {
	    console.log("Closed");
	    this.create_new		= false;

	    // TODO: we would be able to use reset if there was a way to 'move' the path rather than
	    // copy it.  Currently, reset will create a new mutable from the state rather than the
	    // default because the state has been populated with the write response.
	    //
	    // this.$modwc.resetMutable( "post/new" );
	    this.$modwc.purge( "post/new" );
	}
    },
});

Object.assign( app.config.globalProperties, {
    "$modwc":		modwc,
    "$debug":		JSON2.debug,
});

Object.assign( app.config.compilerOptions, {
    isCustomElement ( tag ) {
	return !!customElements.get( tag );
    },
});

const template_html			= await (await fetch("vue_user_post.html")).text();

app.component( 'vue-user-post', {
    "template": template_html,
    "props": {
	"postId": {
	    "type": String,
	    "required": true,
	},
	"editing": {
	    "type": Boolean,
	    "default": false,
	},
	"onsave": {
	    "type": Function,
	},
    },
    data () {
	return {
	    "postid": this.postId,
	    "show_editor": this.editing,
	};
    },
    "computed": {
	datapath () {
	    return this.postid ? `post/${this.postid}` : this.$modwc.DEADEND;
	},
	metastate () {
	    return this.$modwc.metastate[ this.datapath ];
	},
	state () {
	    return this.$modwc.state[ this.datapath ];
	},
	mutable () {
	    return this.$modwc.mutable[ this.datapath ];
	},
	errors () {
	    return this.$modwc.errors[ this.datapath ];
	},
    },
    "methods": {
	showEditor () {
	    this.show_editor		= true;
	},
	hideEditor () {
	    this.show_editor		= false;
	},
	resetMutable () {
	    this.$modwc.resetMutable( this.datapath );
	},
	async savePost () {
	    await this.$modwc.write( this.datapath );

	    this.show_editor		= false;
	    this.postid			= this.state.id;

	    console.log("onsave", this.onsave );
	    this.onsave && this.onsave();

	    console.log("Trigger all/posts read");
	    this.$modwc.read("all/posts");
	},
    },
});

app.mount("#app");
window.app				= app;
