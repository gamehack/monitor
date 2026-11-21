// Feishu may return HTTP 200 for a rejected webhook. Check its provider code.
export function feishuReceipt(httpStatus,body) {
 const status=Number(httpStatus)||0;
 const rawCode=body?.code ?? body?.StatusCode ?? body?.errcode;
 const numericCode=rawCode==null?null:Number(rawCode);
 const code=Number.isInteger(numericCode)?numericCode:null;
 const accepted=status>=200&&status<300&&code===0;
 const blocked=[19001,19002,19024,9499].includes(code)||
  [400,401,403,404,410].includes(status);
 return {accepted,code,transportStatus:status,retryable:!accepted&&!blocked};
}
