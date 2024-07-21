import type { RequestContext } from '@vercel/edge';

export const config = {
  runtime: 'edge',
};

interface Zone {
  readonly id: string | undefined,
  name: string,
  ttl: number
};
interface ZonesResponse {
  readonly zones: Zone[]
};
interface DNSRecord {
  readonly id: string | undefined,
  name: string,
  type: string,
  ttl: number,
  value: string,
  zone_id: string
};
interface RecordsResponse {
  readonly records: DNSRecord[]
}

interface RecordResponse {
  readonly record: DNSRecord
}

type DNSAPIResponse = ZonesResponse | RecordsResponse | RecordResponse;

async function _call_dns_api(path: string, body:string|object|undefined=undefined, method="GET", endpoint="dns.hetzner.com", version="v1", pathPrefix="api", schema="https") {
  if (!!path && path.length > 0 && path[0] === "/")
    path = path.substring(1)
  if (!!pathPrefix && pathPrefix.length > 0 && pathPrefix[0] !== "/")
    pathPrefix = `/${pathPrefix}`
  const url = `${schema}://${endpoint}${pathPrefix}/${version}/${path}`
  console.log(url)
  return fetch(url, {
    method: method,
    body: JSON.stringify(body),
    headers: {
      'Auth-API-Token': process.env.HETZNER_API_TOKEN,
      'Content-type': 'application/json'
    }
  }).then(res => res.text()).then(raw => {
    console.log(raw)
    return JSON.parse(raw)
  })
}

function handleUpsertResponse(res: DNSAPIResponse) {
  if (!!res && !!(res as RecordResponse).record) {
    return { success: true, message: "Ok", status: 200 };
  } else {
    return { success: false, message: "Something went wrong", status: 500 };
  }
}

async function update_dns(zoneName: string, subdomain: string, ip: string) {
  // GET https://dns.hetzner.com/api/v1/zones?name={{DNS_ZONE_NAME}}
  const zones = await _call_dns_api(`zones?name=${zoneName}`)
  if (!!zones && !!(zones as ZonesResponse).zones && (zones as ZonesResponse).zones.length > 0) {
    // GET https://dns.hetzner.com/api/v1/records?zone_id={{ZONE_ID}}
    const records = (await _call_dns_api(`records?zone_id=${(zones as ZonesResponse).zones[0].id}`) as RecordsResponse).records
      if (!!records && records.length > 0) {
        const filtered = records.filter((record: DNSRecord) => record.name === subdomain)
        if (filtered.length > 0) {
          // PUT https://dns.hetzner.com/api/v1/records/628da5c132306ef1aa6623cf899ae18f
          const update = await _call_dns_api(`records/${filtered[0].id}`, {
            type: filtered[0].type,
            name: filtered[0].name,
            value: ip,
            ttl: filtered[0].ttl,
            zone_id: filtered[0].zone_id,
          }, "PUT")
          return handleUpsertResponse(update)
        } else {
          // POST https://dns.hetzner.com/api/v1/records
          const update = await _call_dns_api(`records`, {
            type: "A",
            name: subdomain,
            value: ip,
            ttl: 0,
            zone_id: (zones as ZonesResponse).zones[0].id,
          }, "POST")
          return handleUpsertResponse(update)
        }
      } else {
        return { success: false, message: "No Records found", status: 404 };
      }
    } else {
      return { success: false, message: "Zone not found", status: 404 };
    }
  }

// https://useruser:password@xxxxx.vercel.app/api/update?ip=xxx.xxx.xxx.xxx&domain=xxxx.xxx
export function GET(request: Request, context: RequestContext) {
  const params = new URLSearchParams(new URL(request.url).search)
  const ip = params.get("ip") || request.headers.get("x-forwarded-for");
  const domain = params.get("domain") || "";
  const subdomain = domain.split(".")[0];
  const zoneName = domain.length > subdomain.length + 1 ? domain.substring(subdomain.length + 1) : "";

  if (!zoneName || zoneName.length <= 0 || !ip || ip.length <= 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const basicAuth = request.headers.get('authorization')
  if (basicAuth) {
    const auth = basicAuth.split(' ')[1]
    const [user, pwd] = atob(auth).split(":")

    if (user === 'QGjmP5fJ' && pwd === '6EsETKtNS7w4CGzR3zZJXyDbBQ6CzPACccQqaRE9vyc4FgMX') {
      context.waitUntil(update_dns(zoneName, subdomain, ip)
        .then((result) => {
          console.log(result)
          const message = result.message ?? (result.success ? "Ok" : "Error!")
          const status = result.status ?? (result.success ? 200 : 500)
          return new Response(message, {status})
        }))
    }
  }

  return new Response('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  })
}