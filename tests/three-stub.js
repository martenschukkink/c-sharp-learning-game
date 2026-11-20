(function(){
const handler={get(t,p){ if(p===Symbol.toPrimitive) return ()=>0; if(p==='then') return undefined; if(p==='prototype') return {}; if(!(p in t)) t[p]=mk(); return t[p]; }, set(t,p,v){t[p]=v;return true;}, apply(){return mk();}, construct(){return mk();}};
function mk(){ return new Proxy(function(){}, handler); }
window.THREE=mk();
})();
window.THREE.Clock = function(){ let last=performance.now(); this.elapsedTime=0; this.getDelta=function(){const n=performance.now(); const d=(n-last)/1000; last=n; this.elapsedTime+=d; return d;}; };
