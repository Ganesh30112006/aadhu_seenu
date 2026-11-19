cmake_minimum_required(VERSION 3.16)
project(lc_core_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(LC_CORE_DIR ${CMAKE_CURRENT_LIST_DIR}/..)
add_executable(lc_core_tests
    ${CMAKE_CURRENT_LIST_DIR}/test_main.c
    ${LC_CORE_DIR}/src/lc_frame.c
    ${LC_CORE_DIR}/src/lc_adpcm.c
    ${LC_CORE_DIR}/src/lc_ack.c
    ${LC_CORE_DIR}/src/lc_ring.c
    ${LC_CORE_DIR}/src/lc_flashlog.c
    ${LC_CORE_DIR}/src/lc_backoff.c)
target_include_directories(lc_core_tests PRIVATE ${LC_CORE_DIR}/include)
target_compile_definitions(lc_core_tests PRIVATE _USE_MATH_DEFINES)
if(MSVC)
    target_compile_definitions(lc_core_tests PRIVATE _CRT_SECURE_NO_WARNINGS)
    target_compile_options(lc_core_tests PRIVATE /W3)
else()
    target_compile_options(lc_core_tests PRIVATE -Wall -Wextra -Werror -fsanitize=address,undefined)
    target_link_options(lc_core_tests PRIVATE -fsanitize=address,undefined)
    target_link_libraries(lc_core_tests m)
endif()
