#include "craidd_gold.hpp"
#include <thread>
#include <chrono>
#include <cstdlib>
int recursion(int n) {
 craidd_gold::Range r("recursive","Recursive work");
 volatile unsigned value=1;for(int i=0;i<10000;i++)value=value*31u+i;
 if(n>0)recursion(n-1);
 r.finish();return value;
}
void early_return(){craidd_gold::Range r("early","Early return");}
int main(){
 craidd_gold::solo("solo","Overall recording");
 craidd_gold::solo("solo","Overall recording");
 recursion(2);early_return();
 {craidd_gold::Range r("memory","Memory cohort");void* p=std::malloc(64);craidd_gold::allocated(p,64);r.finish();std::thread free_thread([p]{craidd_gold::freed(p);std::free(p);});free_thread.join();}
 std::thread a([]{recursion(0);}),b([]{recursion(0);});a.join();b.join();
 std::this_thread::sleep_for(std::chrono::milliseconds(100));
}
