export type Relation={name:string;positions:string[];symbols:string;rule:string};
/** Matches symbols only; no claim about transformation, strength or predicted events. */
export function pillarRelations(gans:(string|null)[],zhis:(string|null)[]):Relation[]{
 const result:Relation[]=[];const labels=['年柱','月柱','日柱','时柱'];
 const pairs=(name:string,rules:string[],values:(string|null)[])=>{for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
  const a=values[i],b=values[j];if(a&&b&&rules.some(rule=>rule===a+b||rule===b+a))result.push({name,positions:[labels[i],labels[j]],symbols:a+b,rule:`${name}配对表`});
 }};
 pairs('天干五合',['甲己','乙庚','丙辛','丁壬','戊癸'],gans);
 pairs('地支六合',['子丑','寅亥','卯戌','辰酉','巳申','午未'],zhis);
 pairs('地支六冲',['子午','丑未','寅申','卯酉','辰戌','巳亥'],zhis);
 pairs('地支六害',['子未','丑午','寅巳','卯辰','申亥','酉戌'],zhis);
 pairs('相刑',['子卯','寅巳','巳申','寅申','丑戌','戌未','丑未'],zhis);pairs('自刑',['辰辰','午午','酉酉','亥亥'],zhis);
 for(const [name,groups] of [['三刑',['寅巳申','丑戌未']],['三合',['申子辰','亥卯未','寅午戌','巳酉丑']],['三会',['寅卯辰','巳午未','申酉戌','亥子丑']]] as const){
  for(const group of groups)if([...group].every(z=>zhis.includes(z)))result.push({name,positions:labels.filter((_,i)=>zhis[i]&&group.includes(zhis[i]!)),symbols:group,rule:'完整三支齐备；不判断合化'});
 }
 return result;
}
