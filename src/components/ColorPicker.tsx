const SWATCHES=["#E85D26","#E8A317","#2ECC71","#3498DB","#9B59B6","#E84393","#FDCB6E","#636E72"];
export function ColorPicker({value,onChange}:{value:string;onChange:(c:string)=>void}){
  return <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
    {SWATCHES.map(c=> <button key={c} type="button" aria-label={c} onClick={()=>onChange(c)} style={{width:28,height:28,borderRadius:7,background:c,border:value===c?"2px solid var(--accent-orange)":"1px solid var(--border)"}}/>)}
    <input type="color" value={value} onChange={e=>onChange(e.target.value)} style={{width:28,height:28,padding:0,border:"1px solid var(--border)",borderRadius:7,background:"transparent"}}/>
  </div>;
}
