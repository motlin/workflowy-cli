export default {
	fetch(request: Request): Response {
		const {pathname} = new URL(request.url);
		if (pathname === "/health") {
			return Response.json({status: "ok"});
		}
		return new Response("Not found", {status: 404});
	},
} satisfies ExportedHandler;
