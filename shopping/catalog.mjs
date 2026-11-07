// Fictional, fixed demo data. Amounts are integer USD cents.
const groups = [
 ['harbor','Harbor Blend','dark','low','Chocolate and toasted nuts',1400,1600,8,4],
 ['cedar','Cedar Roast','medium-dark','low','Caramel and cocoa',1500,1500,6,1],
 ['sunrise','Sunrise Roast','medium','medium','Orange and brown sugar',1700,1700,5,5],
 ['bloom','Bloom Light','light','high','Berry and citrus',1800,1900,3,3],
];
export const catalog=Object.freeze(groups.flatMap(([groupId,name,roast,acidity,flavor,beans,ground,bs,gs])=>[
 Object.freeze({id:groupId+'-beans',groupId,name,weightGrams:250,form:'whole beans',roast,acidity,flavor,priceCents:beans,initialStock:bs}),
 Object.freeze({id:groupId+'-ground',groupId,name,weightGrams:250,form:'ground',roast,acidity,flavor,priceCents:ground,initialStock:gs})]));
export const money=c=>'$'+(c/100).toFixed(2)+' USD';
export const label=p=>`${p.name}, ${p.form}, ${p.weightGrams} grams`;
