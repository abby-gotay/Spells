import { extname } from "https://deno.land/std@0.165.0/path/mod.ts"
import { contentType } from "https://deno.land/std@0.177.0/media_types/mod.ts"
import { compile, compileTS, startTSServer } from "./compile.ts"


/** Text to be served, which overrides file access. */
export const serveText: {
	[key: string]: {
		data: () => string,
		type: string
	}
} = {}

/** Check if a path exists (as either a file or a directory.) */
async function exists(f: string): Promise<boolean> {
	try {
		await Deno.stat(f)
		return true
	} catch {
		return false
	}
}

async function getData(f: string): Promise<Deno.FileInfo | undefined> {
	try {
		return await Deno.stat(f)
	} catch {}
}

/** Handles a single request, which only uses the given path. */
async function handleRequest(path: string, fullPath: string, silent?: boolean): Promise<Response> {
	let throw404 = false

	// if (path.length == 0) {
	// 	path = "/"
	// }

	// Default to `index.spl`, then check `index.html` and finally send a directory.
	if (path.endsWith("/") || path.length == 0) {
		// If the path is into a directory, then great!
		if (await exists(path + "index.spl")) path += "index.spl"
		else if (await exists(path + "index.html")) path += "index.html"
		else if (await exists(path)) path += "[dir]"
		else throw404 = true
	} else {
		// If it's not into a directory (directly)...
		const data = await getData(path)
		if (!data) {
			throw404 = true
		} else if (data.isDirectory) {
			return Response.redirect(fullPath + "/", 302)
		}
	}

	// Log
	if (!silent) console.log(
		// The path that's being gotten
		"/" + path + " ",

		// The current time as a string
		new Date().toTimeString().replace(/ \(.*/g, "")
	)

	// If the path is in the seveText dictionary...
	if (!throw404 && path in serveText) {
		const headers = new Headers()
		headers.set("Content-Type", serveText[path].type)
		return new Response(
			serveText[path].data() + "",
			{ headers }
		)
	}

	// If it's a real file path
	if (!throw404 && path.endsWith("/[dir]")) {
		const dir = path.slice(0, -6)
		let ret = `<style>html{background-color:white;filter:invert(1)}*{font-family:monospace;margin-bottom:0}a{color:#0d4500}</style><h1 style="margin-top:20px">Directory Listing of ./${dir}</h1><br>\n`
		for await (const f of Deno.readDir("./" + dir)) {
			ret += `<a href="${'./' + f.name}">${f.name}</a><br>\n`
		}
		const headers = new Headers()
		headers.set("Content-Type", "text/html")
		return new Response(ret, { status: 404, headers })
	} else try {
		let file: Uint8Array | string = await Deno.readFile(path)
		let sct = path.endsWith(".ts") ? "text/javascript" : contentType(extname(path)) ?? "text/plain"

		if (path.endsWith("spl")) {
			// Replace .spl files with compiled HTML
			file = compile(new TextDecoder().decode(file))
			sct = "text/html"
		} else if (path.endsWith(".ts")) {
			// Replace .ts files with JavaScript
			file = compileTS(new TextDecoder().decode(file), fullPath)
		}

		// Send the file over
		const headers = new Headers()
		headers.set("Content-Type", sct)
		return new Response(file, { headers })
	} catch {
		// Check if file exists as `.ts` instead of `.js`
		if (path.endsWith(".js"))
			return handleRequest(path.slice(0, -3) + ".ts", fullPath)

		if (!silent) console.log(" > 404")
		return new Response("404: Not Found!", { status: 404 })
	}

	return new Response("Something went wrong!", { status: 404 })
}

/** Handles a single connection to the server */
async function handleConnection(conn: Deno.Conn, silent?: boolean) {
	const httpConn = Deno.serveHttp(conn)
	for await (const requestEvent of httpConn) {
		const { request } = requestEvent
		const url = new URL(request.url)
		const path = url.pathname.substring(1)
		requestEvent.respondWith(handleRequest(path, request.url, silent))
	}
}

interface StartServerOptions {
	/** The port number of the server */
	port: number

	/** The address of the server. Defaults to "localhost" */
	bind?: string

	/** Wether or not the server emits any messages */
	silent?: boolean
}

/** Start the server (non-blocking) */
export async function startServer(options: StartServerOptions) {
	startTSServer()
	const listener = Deno.listen({ port: options.port })
	if (!options.silent) console.log(`Server running at http://${options.bind ?? "localhost"}:${options.port}/`)
	for await (const conn of listener)
		handleConnection(conn, options.silent)
}

// Start if this isn't an import
if (import.meta.main)
	startServer({ port: 8080 })
