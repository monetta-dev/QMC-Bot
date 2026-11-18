export async function verifySignature(body,signature,secret) {
  if(!signature || !secret || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  try {
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(body));
  } catch {return false;}
}
export async function lineRequest(env,path,{method='GET',body,retryKey}={}) {
  if(!env.LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINEの接続設定がまだ完了していません');
  const response=await fetch(`https://api.line.me${path}`,{method,headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,...(body?{'Content-Type':'application/json'}:{}),...(retryKey?{'X-Line-Retry-Key':retryKey}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
  if(response.status===409 && response.headers.get('x-line-accepted-request-id')) return {accepted:true};
  if(!response.ok) {
    const error=new Error(response.status===429?'LINEの送信上限または利用制限に達しました':`LINEとの通信に失敗しました（${response.status}）`);
    error.status=response.status;
    error.retryable=response.status>=500 || response.status===429;
    throw error;
  }
  return response.status===204?{}:response.json();
}
export const push=(env,payload,key)=>lineRequest(env,'/v2/bot/message/push',{method:'POST',body:payload,retryKey:key});
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''); }
export function b64url(bytes) {return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
