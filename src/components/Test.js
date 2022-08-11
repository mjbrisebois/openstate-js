export default function () {
    return {
	"template": `\
<div>
    Hello World
</div>
`,
	"props": {
	    "input": {
		"type": String,
	    },
	},
	data () {
	    return {
		"name": this.input,
	    }
	},
	"methods": {
	    async test () {
		return this.name;
	    },
	},
    };
}
