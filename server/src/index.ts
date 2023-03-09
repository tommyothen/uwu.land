import { prisma } from "./PrismaClient";
import { nanoid } from "nanoid";
import { z } from "zod";

export interface Env {
  UwU: KVNamespace;
  Clicks: KVNamespace;
}

const schemas = {
  body: z.object({
    url: z.string().url(),
    id: z
      .string()
      .trim()
      // Not allowed anything that will interfere with the URL
      // Min length of 3, max of 16
      .regex(/^[\w\-]{3,16}$/i)
      .optional(),
  }),
};

// Adds cors headers to the response
class CORSResponse extends Response {
  constructor(
    bodyInit?: BodyInit | null | undefined,
    maybeInit?: Response | ResponseInit | undefined
  ) {
    super(bodyInit, maybeInit);

    this.headers.set("Access-Control-Allow-Origin", "https://app.uwu.land");
    // this.headers.set("Access-Control-Allow-Origin", "*");
    this.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    this.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }
}

interface IResponse {
  status: number;
  message: string;
  errors?: z.ZodIssue[];
}
const createErrorResponse = ({ status, message, errors }: IResponse) => {
  return new CORSResponse(
    JSON.stringify({
      status,
      message,
      errors,
    }),
    {
      status,
      headers: {
        "content-type": "application/json;charset=UTF-8",
      },
    }
  );
};

const handleGET = async (request: Request, { UwU, Clicks }: Env): Promise<Response> => {
  // Get slug from request
  const url = decodeURI(request.url);
  const slug = url.split("/")[3];

  // If there is no slug, the redirect URL is https://app.uwu.land
  if (!slug) {
    return Response.redirect("https://app.uwu.land");
  }

  // Get the redirect URL from KV by slug
  const redirect = await UwU.get(slug);

  // If there is no redirect URL, the redirect URL is https://app.uwu.land/404
  if (!redirect) {
    return Response.redirect("https://app.uwu.land/404");
  }

  // Increment the redirect count
  const count = await Clicks.get(slug);

  if (count) {
    await Clicks.put(slug, (parseInt(count) + 1).toString());
  } else {
    await Clicks.put(slug, "1");
  }

  // Redirect to the redirect URL
  return Response.redirect(redirect);
};

const handlePOST = async (request: Request, { UwU, Clicks }: Env): Promise<Response> => {
  // Get the body from the request
  const body: {
    url?: string;
    id?: string;
  } = await request.json();

  // Validate the body
  const result = schemas.body.safeParse(body);

  // If the body is invalid, return a 400
  if (!result.success) {
    return createErrorResponse({
      status: 400,
      message: "Invalid body",
      errors: result.error.errors,
    });
  }

  // Get the URL and ID from the body
  let { url, id } = result.data;

  if (url.includes("uwu.land")) {
    return createErrorResponse({
      status: 400,
      message: "Cannot use uwu.land as a redirect URL",
    });
  }

  // Check if the URL is in the banned list
  const domain = new URL(url).hostname;
  const banned = await prisma.bannedURLs.findFirst({
    where: {
      url: {
        contains: domain,
      },
    },
  });

  if (banned) {
    return createErrorResponse({
      status: 400,
      message: "URL is banned",
    });
  }

  // We can save space in the database by removing duplicate urls
  const existingRedirect = await prisma.redirect.findFirst({
    where: {
      url,
    },
  });

  if (existingRedirect) {
    return new CORSResponse(
      JSON.stringify({
        id: existingRedirect.slug,
        url: `http://uwu.land/${existingRedirect.slug}`,
      }),
      {
        status: 201,
        headers: {
          "content-type": "application/json;charset=UTF-8",
        },
      }
    );
  }

  // If we have an ID, check if it's already in use
  if (id) {
    const redirect = await prisma.redirect.findFirst({
      where: {
        slug: id,
      },
    });

    // If the ID is already in use, return a 409
    if (redirect) {
      return createErrorResponse({
        status: 409,
        message: "ID already in use",
      });
    }
  } else {
    // If we don't have an ID, generate one
    id = nanoid(5);

    // Check if the ID is already in use
    while (await prisma.redirect.findFirst({ where: { slug: id } })) {
      id = nanoid(5);
    }
  }

  // Set the redirect URL in prisma
  await prisma.redirect.create({
    data: {
      slug: id,
      url,
    },
  });

  // Set the redirect URL in KV
  await UwU.put(id, url);
  await Clicks.put(id, "0");

  // Return a 201 with the ID and URL
  return new CORSResponse(
    JSON.stringify({
      id,
      url: `http://uwu.land/${id}`,
    }),
    {
      status: 201,
      headers: {
        "content-type": "application/json;charset=UTF-8",
      },
    }
  );
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Log drains are set up in the Cloudflare dashboard
    console.info({
      level: "Info",
      message: `${request.method} ${request.url}`,
      // Unfortunatly, we need to log since there's a lot of people who abuse the service
      meta: {
        location: {
          long: request.cf?.longitude,
          lat: request.cf?.latitude,
          continent: request.cf?.continent,
          country: request.cf?.country,
          timezone: request.cf?.timezone,
          region: request.cf?.region,
          city: request.cf?.city,
          postalCode: request.cf?.postalCode,
        },
        ip:
          request.headers.get("CF-Connecting-IP") ||
          request.headers.get("X-Forwarded-For") ||
          request.headers.get("X-Real-IP"),
      },
    });

    switch (request.method) {
      case "GET":
        return await handleGET(request, env);
      case "POST":
        return await handlePOST(request, env);
      case "OPTIONS":
        return new CORSResponse("", { status: 200 });
      default:
        return new CORSResponse("Method not allowed", { status: 405 });
    }
  },
};
