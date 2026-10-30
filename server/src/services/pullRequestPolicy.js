function idOf(value){return String(value?._id??value??"");}
export function evaluateReviewGate(reviews=[],authorId){
 const author=idOf(authorId);
 const independent=(Array.isArray(reviews)?reviews:[]).filter(review=>idOf(review.user)!==author);
 if(independent.some(review=>review.decision==="changes_requested"))return {allowed:false,reason:"changes_requested"};
 if(!independent.some(review=>review.decision==="approved"))return {allowed:false,reason:"approval_required"};
 return {allowed:true,reason:null};
}
